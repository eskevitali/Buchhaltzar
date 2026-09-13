#!/usr/bin/env python3
"""Install Buchhaltzar into an Obsidian vault without touching hidden folders by hand."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PLUGIN_ID = "buchhaltzar"
PLUGIN_FILES = ("manifest.json", "main.js", "styles.css")


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def default_plugin_dir() -> Path:
    nested = script_dir() / PLUGIN_ID
    if (nested / "manifest.json").is_file():
        return nested
    if (script_dir() / "manifest.json").is_file():
        return script_dir()
    raise SystemExit("Рядом с установщиком нет папки buchhaltzar с manifest.json, main.js и styles.css.")


def obsidian_config_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "obsidian"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if not appdata:
            raise SystemExit("Не найден каталог APPDATA.")
        return Path(appdata) / "obsidian"
    return Path.home() / ".config" / "obsidian"


def known_vaults() -> list[dict[str, str]]:
    config = obsidian_config_dir() / "obsidian.json"
    if not config.is_file():
        return []
    try:
        data = json.loads(config.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    vaults = []
    for info in (data.get("vaults") or {}).values():
        raw = info.get("path") if isinstance(info, dict) else None
        if not raw:
            continue
        path = Path(raw)
        if path.is_dir():
            vaults.append({"name": path.name, "path": str(path)})
    vaults.sort(key=lambda item: item["name"].casefold())
    return vaults


def have_command(name: str) -> bool:
    return shutil.which(name) is not None


def zenity(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["zenity", *args], check=False, capture_output=True, text=True)


def choose_vault_interactive(vaults: list[dict[str, str]]) -> Path:
    if have_command("zenity") and vaults:
        command = [
            "zenity", "--list", "--radiolist",
            "--title=Установка Buchhaltzar",
            "--text=Выберите хранилище Obsidian, в которое поставить плагин.",
            "--column=", "--column=Хранилище", "--column=Путь",
            "--print-column=3", "--width=640", "--height=360",
        ]
        for index, vault in enumerate(vaults):
            command.extend(["TRUE" if index == 0 else "FALSE", vault["name"], vault["path"]])
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip())
        if result.returncode != 0:
            raise SystemExit("Установка отменена.")
    if have_command("zenity"):
        result = zenity(
            "--file-selection", "--directory",
            "--title=Выберите папку хранилища Obsidian",
        )
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip())
        raise SystemExit("Установка отменена.")
    try:
        import tkinter as tk
        from tkinter import filedialog, simpledialog
    except Exception:
        tk = None  # type: ignore
    else:
        root = tk.Tk()
        root.withdraw()
        if vaults:
            names = [f"{item['name']}  —  {item['path']}" for item in vaults]
            choice = simpledialog.askstring(
                "Установка Buchhaltzar",
                "Введите номер хранилища:\n" + "\n".join(f"{i + 1}. {name}" for i, name in enumerate(names)),
            )
            root.destroy()
            if not choice:
                raise SystemExit("Установка отменена.")
            try:
                return Path(vaults[int(choice) - 1]["path"])
            except (ValueError, IndexError):
                raise SystemExit("Некорректный номер хранилища.") from None
        selected = filedialog.askdirectory(title="Выберите папку хранилища Obsidian")
        root.destroy()
        if not selected:
            raise SystemExit("Установка отменена.")
        return Path(selected)
    if not sys.stdin.isatty():
        raise SystemExit("Запустите установщик из терминала: python3 install.py")
    if vaults:
        print("Найденные хранилища Obsidian:\n")
        for index, vault in enumerate(vaults, start=1):
            print(f"  {index}. {vault['name']}\n     {vault['path']}")
        print("  0. Указать другую папку")
        raw = input("\nНомер хранилища: ").strip()
        if raw == "0":
            return Path(input("Путь к папке хранилища: ").strip()).expanduser()
        try:
            return Path(vaults[int(raw) - 1]["path"])
        except (ValueError, IndexError):
            raise SystemExit("Некорректный номер хранилища.") from None
    path = input("Obsidian ещё не знает хранилищ. Путь к папке vault: ").strip()
    if not path:
        raise SystemExit("Установка отменена.")
    return Path(path).expanduser()


def notify(title: str, text: str, error: bool = False, quiet: bool = False) -> None:
    stream = sys.stderr if error else sys.stdout
    print(f"{title}: {text}", file=stream)
    if quiet or not have_command("zenity"):
        return
    zenity("--error" if error else "--info", f"--title={title}", f"--text={text}", "--width=480")


def validate_plugin_dir(plugin_dir: Path) -> Path:
    missing = [name for name in PLUGIN_FILES if not (plugin_dir / name).is_file()]
    if missing:
        raise SystemExit(f"В {plugin_dir} нет файлов: {', '.join(missing)}")
    return plugin_dir


def enable_plugin(vault: Path) -> None:
    config_dir = vault / ".obsidian"
    config_dir.mkdir(parents=True, exist_ok=True)
    config = config_dir / "community-plugins.json"
    enabled: list[str] = []
    if config.is_file():
        try:
            parsed = json.loads(config.read_text(encoding="utf-8"))
            if isinstance(parsed, list):
                enabled = [str(item) for item in parsed]
        except json.JSONDecodeError:
            enabled = []
    if PLUGIN_ID not in enabled:
        enabled.append(PLUGIN_ID)
        config.write_text(json.dumps(enabled, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def install(vault: Path, plugin_dir: Path) -> Path:
    if not vault.is_dir():
        raise SystemExit(f"Нет такой папки: {vault}")
    target = vault / ".obsidian" / "plugins" / PLUGIN_ID
    target.mkdir(parents=True, exist_ok=True)
    for name in PLUGIN_FILES:
        shutil.copy2(plugin_dir / name, target / name)
    enable_plugin(vault)
    return target


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Установка Buchhaltzar в хранилище Obsidian.")
    parser.add_argument("--vault", type=Path, help="Папка хранилища (без вопросов).")
    parser.add_argument("--plugin-dir", type=Path, help="Каталог с manifest.json, main.js, styles.css.")
    parser.add_argument("--yes", action="store_true", help="Не спрашивать подтверждение.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    quiet = bool(args.yes or args.vault)
    try:
        plugin_dir = validate_plugin_dir((args.plugin_dir or default_plugin_dir()).resolve())
        vault = (args.vault or choose_vault_interactive(known_vaults())).expanduser().resolve()
        if not quiet and sys.stdin.isatty():
            answer = input(f"Установить Buchhaltzar в\n  {vault}\n? [y/N] ").strip().lower()
            if answer not in {"y", "yes", "д", "да"}:
                raise SystemExit("Установка отменена.")
        elif not quiet and have_command("zenity"):
            confirm = zenity(
                "--question",
                "--title=Установка Buchhaltzar",
                f"--text=Установить плагин в хранилище:\n{vault}",
            )
            if confirm.returncode != 0:
                raise SystemExit("Установка отменена.")
        target = install(vault, plugin_dir)
    except SystemExit as error:
        message = str(error)
        if message:
            notify("Buchhaltzar", message, error=True, quiet=quiet)
        return 1
    notify(
        "Buchhaltzar установлен",
        "Плагин записан в:\n"
        f"{target}\n\n"
        "Откройте это хранилище в Obsidian. Если появится запрос про сторонние плагины — разрешите. "
        "Затем Настройки → Сторонние плагины → Buchhaltzar — включите, если ещё не включён. "
        "Перезапустите Obsidian, если панель не появилась.",
        quiet=quiet,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

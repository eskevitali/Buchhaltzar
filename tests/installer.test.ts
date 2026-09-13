import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const installer = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "installer", "install.py");

function python(): string {
  try {
    execFileSync("python3", ["-V"], { stdio: "ignore" });
    return "python3";
  } catch {
    return "python";
  }
}

describe("desktop installer", () => {
  it("copies plugin files, enables the plugin, and keeps data.json", () => {
    const root = mkdtempSync(join(tmpdir(), "buchhaltzar-install-"));
    const pluginDir = join(root, "plugin");
    const vault = join(root, "My Vault");
    mkdirSync(pluginDir);
    mkdirSync(join(vault, ".obsidian", "plugins", "buchhaltzar"), { recursive: true });
    writeFileSync(join(pluginDir, "manifest.json"), '{"id":"buchhaltzar","version":"0.8.2"}\n');
    writeFileSync(join(pluginDir, "main.js"), "module.exports = class {};\n");
    writeFileSync(join(pluginDir, "styles.css"), "/* test */\n");
    writeFileSync(join(vault, ".obsidian", "plugins", "buchhaltzar", "data.json"), "{\"keep\":true}\n");
    writeFileSync(join(vault, ".obsidian", "community-plugins.json"), "[\"calendar\"]\n");

    execFileSync(python(), [installer, "--vault", vault, "--plugin-dir", pluginDir, "--yes"], { encoding: "utf8" });

    expect(readFileSync(join(vault, ".obsidian", "plugins", "buchhaltzar", "manifest.json"), "utf8")).toContain("0.8.2");
    expect(existsSync(join(vault, ".obsidian", "plugins", "buchhaltzar", "main.js"))).toBe(true);
    expect(readFileSync(join(vault, ".obsidian", "plugins", "buchhaltzar", "data.json"), "utf8")).toContain("keep");
    expect(JSON.parse(readFileSync(join(vault, ".obsidian", "community-plugins.json"), "utf8"))).toEqual(["calendar", "buchhaltzar"]);
  });
});

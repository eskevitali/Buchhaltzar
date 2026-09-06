import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyFile } from "node:fs/promises";

const production = process.argv[2] === "production";
await copyFile("src/content/Добро пожаловать.md", "vault-template/Добро пожаловать.md");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  loader: { ".png": "dataurl", ".md": "text" },
  outfile: "main.js",
  minify: production
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}

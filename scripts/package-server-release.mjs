import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(projectRoot, "manifest.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("manifest.json contains an invalid version");

const outputRoot = resolve(projectRoot, "dist", "server", "buchhaltzar");
const releaseDir = resolve(outputRoot, manifest.version);
if (!outputRoot.startsWith(`${projectRoot}/dist/`)) throw new Error("Unsafe output path");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const pluginFiles = ["main.js", "manifest.json", "styles.css"];
for (const filename of pluginFiles) await copyFile(resolve(projectRoot, filename), resolve(releaseDir, filename));
await copyFile(resolve(projectRoot, "versions.json"), resolve(outputRoot, "versions.json"));

const stagingDir = resolve(outputRoot, "zip-staging");
const stagedPlugin = resolve(stagingDir, "buchhaltzar");
await mkdir(stagedPlugin, { recursive: true });
for (const filename of pluginFiles) await copyFile(resolve(releaseDir, filename), resolve(stagedPlugin, filename));
const installerFiles = ["install.py", "install.sh", "install.ps1", "Установка.txt"];
for (const filename of installerFiles) {
  const destination = resolve(stagingDir, filename);
  await copyFile(resolve(projectRoot, "scripts", "installer", filename), destination);
  if (filename === "install.py" || filename === "install.sh") await chmod(destination, 0o755);
}

const archiveName = `buchhaltzar-${manifest.version}.zip`;
const archivePath = resolve(outputRoot, archiveName);
const zipped = spawnSync("zip", ["-q", "-r", archivePath, "buchhaltzar", ...installerFiles], { encoding: "utf8", cwd: stagingDir });
if (zipped.status !== 0) throw new Error(zipped.stderr || "Unable to create ZIP archive");
await rm(stagingDir, { recursive: true, force: true });

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const hashes = {};
for (const filename of pluginFiles) hashes[`${manifest.version}/${filename}`] = await sha256(resolve(releaseDir, filename));
hashes[archiveName] = await sha256(archivePath);
hashes["versions.json"] = await sha256(resolve(outputRoot, "versions.json"));

const latest = {
  schema: "buchhaltzar.server-release.v1",
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  minAppVersion: manifest.minAppVersion,
  archive: archiveName,
  releasePath: manifest.version,
  files: pluginFiles,
  sha256: hashes
};
await writeFile(resolve(outputRoot, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`, "utf8");
hashes["latest.json"] = await sha256(resolve(outputRoot, "latest.json"));
const checksumLines = Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)).map(([filename, hash]) => `${hash}  ${filename}`);
await writeFile(resolve(outputRoot, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({ outputRoot, releaseDir, archivePath, version: manifest.version, files: [...pluginFiles, "versions.json", "latest.json", "SHA256SUMS", archiveName] }, null, 2));

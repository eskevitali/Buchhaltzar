import { writeFile } from "node:fs/promises";

const websocketUrl = process.argv[2];
if (!websocketUrl) throw new Error("WebSocket URL is required");
const socket = new WebSocket(websocketUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (handler) { pending.delete(message.id); handler(message); }
});
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
function request(method, params = {}) { const id = nextId++; return new Promise((resolve) => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const response = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  return response.result?.result?.value;
}
await request("Runtime.enable"); await request("Page.enable");

const loaded = await evaluate(`(async () => {
  await app.plugins.setEnable(true);
  const previous = app.plugins.plugins.buchhaltzar;
  const key = previous?.getApiKey?.() || "";
  let leaf = app.workspace.getLeavesOfType("buchhaltzar-dashboard")[0] ?? app.workspace.getMostRecentLeaf();
  if (!leaf) throw new Error("No Obsidian leaf available");
  await leaf.setViewState({ type: "empty" });
  if (previous) await app.plugins.unloadPlugin("buchhaltzar");
  await app.plugins.loadPlugin("buchhaltzar");
  await app.plugins.enablePlugin("buchhaltzar");
  const plugin = app.plugins.plugins.buchhaltzar;
  if (key) plugin.setSessionApiKey(key);
  await leaf.setViewState({ type: "buchhaltzar-dashboard", active: true });
  await app.workspace.revealLeaf(leaf);
  await new Promise(resolve => setTimeout(resolve, 700));
  return plugin.manifest.version;
})()`);

async function capture(path, width, height) {
  await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 520 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const response = await request("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path, Buffer.from(response.result.data, "base64"));
}

await capture("/tmp/buchhaltzar-lokvita-desktop.png", 1100, 900);
const desktop = JSON.parse(await evaluate(`JSON.stringify((() => {
  const root = document.querySelector(".buchhaltzar"); const header = document.querySelector(".buchhaltzar__header"); const button = document.querySelector(".buchhaltzar button");
  const cards = [...document.querySelectorAll(".buchhaltzar__account")]; const style = element => getComputedStyle(element);
  return { logo: document.querySelector(".buchhaltzar__brand img")?.src.startsWith("data:image/png"), title: document.querySelector(".buchhaltzar h1")?.textContent, primary: style(document.querySelector(".buchhaltzar h1")).color, headerBackground: style(header).backgroundColor, headerRadius: style(header).borderRadius, buttonHeight: style(button).minHeight, cards: cards.length, horizontalOverflow: root.scrollWidth > root.clientWidth };
})())`));
await evaluate(`(() => { const style = document.createElement("style"); style.id = "buchhaltzar-mobile-qa"; style.textContent = ".workspace-ribbon.mod-left,.workspace-split.mod-left-split{display:none!important}.workspace-split.mod-root{width:100vw!important;left:0!important}"; document.head.appendChild(style); })()`);
await capture("/tmp/buchhaltzar-lokvita-mobile.png", 430, 900);
const mobile = JSON.parse(await evaluate(`JSON.stringify((() => { const root = document.querySelector(".buchhaltzar"); return { width: root.clientWidth, scrollWidth: root.scrollWidth, horizontalOverflow: root.scrollWidth > root.clientWidth, accountColumns: getComputedStyle(document.querySelector(".buchhaltzar__accounts")).gridTemplateColumns, aiColumns: document.querySelector(".buchhaltzar__ai-tools") ? getComputedStyle(document.querySelector(".buchhaltzar__ai-tools")).gridTemplateColumns : null }; })())`));
await evaluate(`document.getElementById("buchhaltzar-mobile-qa")?.remove()`);
await request("Emulation.clearDeviceMetricsOverride");
console.log(JSON.stringify({ loaded, desktop, mobile, screenshots: ["/tmp/buchhaltzar-lokvita-desktop.png", "/tmp/buchhaltzar-lokvita-mobile.png"] }, null, 2));
socket.close();

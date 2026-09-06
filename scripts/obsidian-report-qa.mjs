const websocketUrl = process.argv[2];
if (!websocketUrl) throw new Error("WebSocket URL is required");

const socket = new WebSocket(websocketUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
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
await request("Runtime.enable");

const result = await evaluate(`(async () => {
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
  await new Promise(resolve => setTimeout(resolve, 500));

  const panel = document.querySelector(".buchhaltzar__report-panel");
  const select = panel?.querySelector("select");
  const date = panel?.querySelector('input[type="date"]');
  const create = [...(panel?.querySelectorAll("button") ?? [])].find(button => button.textContent?.trim() === "Сформировать");
  if (!panel || !select || !date || !create) throw new Error("Report controls not found");
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  setValue(select, "month");
  setValue(date, "2026-09-06");
  create.click();
  for (let index = 0; index < 30; index++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (document.querySelector(".buchhaltzar__report-result")) break;
  }
  const path = "Reports/report-month-2026-09-01--2026-09-30.md";
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) throw new Error("Report file was not created");
  const content = await app.vault.cachedRead(file);
  const openButton = [...document.querySelectorAll(".buchhaltzar__report-result button")].find(button => button.textContent?.trim() === "Открыть отчёт");
  openButton?.click();
  await new Promise(resolve => setTimeout(resolve, 300));
  return JSON.stringify({
    loadedManifestVersion: plugin.manifest.version,
    path,
    resultVisible: Boolean(document.querySelector(".buchhaltzar__report-result")),
    transactionCount: Number(/transactionCount: (\\d+)/.exec(content)?.[1] ?? -1),
    hasSummary: content.includes("## Итоги") && content.includes("## Движение по счетам"),
    hasDetails: content.includes("## Расшифровка транзакций") && content.includes("|Открыть]] |"),
    activeFile: app.workspace.getActiveFile()?.path ?? ""
  });
})()`);
console.log(JSON.stringify(JSON.parse(result), null, 2));
socket.close();

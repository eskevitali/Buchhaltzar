const websocketUrl = process.argv[2];
if (!websocketUrl) throw new Error("WebSocket URL is required");

const socket = new WebSocket(websocketUrl);
let nextId = 1;
const pending = new Map();
const events = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.consoleAPICalled") events.push({ type: message.params.type, args: message.params.args?.map((arg) => arg.value ?? arg.description) });
  if (message.method === "Runtime.exceptionThrown") events.push({ type: "exception", text: message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text });
  if (message.method === "Log.entryAdded") events.push({ type: "log", text: message.params.entry?.text });
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (handler) { pending.delete(message.id); handler(message); }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  return response.result?.result?.value;
}

await request("Runtime.enable");
await request("Log.enable");

const before = await evaluate(`JSON.stringify({ manifests: Object.keys(app.plugins.manifests), enabled: [...app.plugins.enabledPlugins] })`);
await evaluate(`app.plugins.setEnable(true)`);
if (!(await evaluate(`app.plugins.enabledPlugins.has("buchhaltzar")`))) {
  await evaluate(`app.plugins.enablePluginAndSave("buchhaltzar")`);
}
const loadAttempt = await evaluate(`(async () => { try { const transientKey = app.plugins.plugins.buchhaltzar?.getApiKey() || ""; if (app.plugins.plugins.buchhaltzar) await app.plugins.unloadPlugin("buchhaltzar"); await app.plugins.loadPlugin("buchhaltzar"); if (transientKey) app.plugins.plugins.buchhaltzar.setSessionApiKey(transientKey); await app.plugins.enablePlugin("buchhaltzar"); return JSON.stringify({ ok: true }); } catch (error) { return JSON.stringify({ ok: false, error: error?.stack || String(error) }); } })()`);
await new Promise((resolve) => setTimeout(resolve, 700));
const after = await evaluate(`JSON.stringify({ enabled: app.plugins.enabledPlugins.has("buchhaltzar"), loaded: Boolean(app.plugins.plugins.buchhaltzar), viewRegistered: Boolean(app.viewRegistry.viewByType["buchhaltzar-dashboard"]), methods: Object.getOwnPropertyNames(Object.getPrototypeOf(app.plugins)), properties: Object.keys(app.plugins).filter(key => /safe|restrict|debug/i.test(key)).reduce((result, key) => (result[key] = app.plugins[key], result), {}) })`);
const noteInitialization = await evaluate(`(async () => {
  const paths = ["Notes/Почему учёт называется царским.md", "Notes/GraviTON — краткая аннотация.md", "Notes/GraviTON_ КОН и архитектура хозяйственной системы.md", "Добро пожаловать.md"];
  const before = new Map();
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    before.set(path, file ? await app.vault.cachedRead(file) : null);
  }
  await app.plugins.plugins.buchhaltzar.initialize(false);
  const checks = [];
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    const content = file ? await app.vault.cachedRead(file) : null;
    checks.push({ path, exists: Boolean(file), preserved: before.get(path) === null || before.get(path) === content });
  }
  return JSON.stringify({ checks });
})()`);
const errors = await evaluate(`JSON.stringify(app.plugins.plugins.buchhaltzar ? [] : ["plugin_not_loaded"])`);
if (JSON.parse(after).loaded) await evaluate(`(() => { const plugin = app.plugins.plugins.buchhaltzar; plugin.settings.ai.enabled = true; plugin.rebuildService(); return plugin.activateView(); })()`);
await new Promise((resolve) => setTimeout(resolve, 700));
const ui = await evaluate(`JSON.stringify({ heading: document.querySelector(".buchhaltzar h1")?.textContent, accountCards: document.querySelectorAll(".buchhaltzar__account").length, operationTypes: document.querySelectorAll(".buchhaltzar form select option").length, submitButton: document.querySelector(".buchhaltzar form > button")?.textContent, voiceButton: [...document.querySelectorAll(".buchhaltzar__ai-tools button")].map(element => element.textContent), receiptButtons: [...document.querySelectorAll(".buchhaltzar__receipt-button")].map(element => ({ label: element.textContent?.trim(), capture: element.querySelector("input")?.getAttribute("capture") })), aiModels: app.plugins.plugins.buchhaltzar.settings.ai ? [app.plugins.plugins.buchhaltzar.settings.ai.textVisionModel, app.plugins.plugins.buchhaltzar.settings.ai.transcriptionModel] : [] })`);
await evaluate(`(() => { const plugin = app.plugins.plugins.buchhaltzar; plugin.settings.ai.enabled = false; plugin.rebuildService(); })()`);
await evaluate(`(async () => { const transientKey = app.plugins.plugins.buchhaltzar?.getApiKey() || ""; await app.plugins.unloadPlugin("buchhaltzar"); await app.plugins.loadPlugin("buchhaltzar"); if (transientKey) app.plugins.plugins.buchhaltzar.setSessionApiKey(transientKey); await app.plugins.plugins.buchhaltzar.activateView(); })()`);
await new Promise((resolve) => setTimeout(resolve, 500));
const restored = await evaluate(`JSON.stringify({ aiEnabled: app.plugins.plugins.buchhaltzar.settings.ai.enabled, aiToolsVisible: Boolean(document.querySelector(".buchhaltzar__ai-tools")) })`);
console.log(JSON.stringify({ before: JSON.parse(before), loadAttempt: JSON.parse(loadAttempt), after: JSON.parse(after), noteInitialization: JSON.parse(noteInitialization), ui: JSON.parse(ui), restored: JSON.parse(restored), errors: JSON.parse(errors), events }, null, 2));
socket.close();

const websocketUrl = process.argv[2];
const imagePath = process.argv[3];
const reloadPlugin = process.argv[4] === "reload";
if (!websocketUrl) throw new Error("WebSocket URL is required");
let imageDataUrl = "";
if (imagePath) {
  const { readFile } = await import("node:fs/promises");
  imageDataUrl = `data:image/png;base64,${(await readFile(imagePath)).toString("base64")}`;
}
const socket = new WebSocket(websocketUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const resolve = pending.get(message.id);
  if (resolve) { pending.delete(message.id); resolve(message); }
});
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  return response.result?.result?.value;
}
const raw = await evaluate(`(async () => {
  let plugin = app.plugins.plugins.buchhaltzar;
  if (!plugin) return JSON.stringify({ ok: false, stage: "plugin", error: "Плагин не загружен" });
  const transientKey = plugin.getApiKey();
  const keyLength = transientKey.length;
  if (!keyLength) return JSON.stringify({ ok: false, stage: "key", error: "Ключ отсутствует в текущем сеансе" });
  if (${JSON.stringify(reloadPlugin)}) {
    await app.plugins.unloadPlugin("buchhaltzar");
    await app.plugins.loadPlugin("buchhaltzar");
    plugin = app.plugins.plugins.buchhaltzar;
    plugin.setSessionApiKey(transientKey);
  }
  plugin.settings.ai.enabled = true;
  plugin.rebuildService();
  const provider = plugin.createAiProvider();
  if (!provider) return JSON.stringify({ ok: false, stage: "provider", error: "Провайдер не создан", keyPresent: true });
  try {
    if (${JSON.stringify(Boolean(imagePath))}) {
      const fullImage = ${JSON.stringify(imageDataUrl)};
      const image = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = fullImage; });
      const start = Math.floor(image.naturalHeight * 0.58); const canvas = document.createElement("canvas"); const scale = Math.min(2, 1800 / image.naturalWidth);
      canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round((image.naturalHeight - start) * scale);
      canvas.getContext("2d").drawImage(image, 0, start, image.naturalWidth, image.naturalHeight - start, 0, 0, canvas.width, canvas.height);
      const draft = await provider.recognizeReceipt([fullImage, canvas.toDataURL("image/jpeg", .9)], "EUR");
      return JSON.stringify({ ok: true, keyPresent: true, receipt: true, model: plugin.settings.ai.textVisionModel, draft });
    }
    await provider.testConnection();
    const draft = await provider.interpretText("Сегодня получил 100 евро на счёт Бизнес. Тест подключения, не проводить.", "EUR");
    return JSON.stringify({ ok: true, keyPresent: true, connection: true, model: plugin.settings.ai.textVisionModel, transcriptionModel: plugin.settings.ai.transcriptionModel, draft });
  } catch (error) {
    return JSON.stringify({ ok: false, keyPresent: true, stage: "api", error: error?.message || String(error), model: plugin.settings.ai.textVisionModel });
  }
})()`);
console.log(JSON.stringify(JSON.parse(raw), null, 2));
socket.close();

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
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
  return response.result?.result?.value;
}
await request("Runtime.enable");

const result = await evaluate(`(async () => {
  await app.plugins.setEnable(true);
  if (!app.plugins.plugins.buchhaltzar) {
    await app.plugins.loadPlugin("buchhaltzar");
    await app.plugins.enablePlugin("buchhaltzar");
  }
  const plugin = app.plugins.plugins.buchhaltzar;
  if (!plugin) throw new Error("Buchhaltzar is not loaded");
  const originalEnabled = plugin.settings.ai.enabled;
  const originalFactory = plugin.createAiProvider;
  const fakeDraft = { type: "expense", amount: "62.69", currency: "EUR", effectiveDate: "2026-09-06", accountId: "urgent", categoryId: "test", counterparty: "UI TEST", paymentMethod: "card", comment: "", lineItems: [] };
  plugin.settings.ai.enabled = true;
  plugin.createAiProvider = () => ({ recognizeReceipt: async () => fakeDraft, transcribe: async () => "", interpretText: async () => fakeDraft, testConnection: async () => {} });
  let leaf = app.workspace.getLeavesOfType("buchhaltzar-dashboard")[0] ?? app.workspace.getMostRecentLeaf();
  if (!leaf) throw new Error("No existing Obsidian tab is available");
  await leaf.setViewState({ type: "buchhaltzar-dashboard", active: true });
  await app.workspace.revealLeaf(leaf);
  await new Promise(resolve => setTimeout(resolve, 500));

  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const button = (text) => [...document.querySelectorAll(".buchhaltzar button")].find(element => element.textContent?.trim() === text);
  const attachSyntheticReceipt = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
    const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, 8, 8);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "ui-test-receipt.png", { type: "image/png" });
    const input = [...document.querySelectorAll('input[type="file"]')].find(element => !element.hasAttribute("capture"));
    const transfer = new DataTransfer(); transfer.items.add(file);
    Object.defineProperty(input, "files", { value: transfer.files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  const before = (await plugin.service.snapshot()).transactions.length;
  await attachSyntheticReceipt();
  const recognized = {
    amount: document.querySelector('input[placeholder="0,00"]')?.value,
    attachment: document.querySelector(".buchhaltzar__attachment")?.textContent?.includes("ui-test-receipt.png")
  };

  button("Разделить расход").click();
  await new Promise(resolve => setTimeout(resolve, 50));
  setValue(document.querySelector('input[aria-label="Сумма части 1"]'), "10,00");
  setValue(document.querySelector('select[aria-label="Счёт части 1"]'), "fund");
  button("+ Добавить часть").click();
  await new Promise(resolve => setTimeout(resolve, 50));
  setValue(document.querySelector('input[aria-label="Сумма части 2"]'), "20,00");
  setValue(document.querySelector('select[aria-label="Счёт части 2"]'), "future");
  setValue(document.querySelector('input[placeholder="Необязательно"]'), "E2E TEST Buchhaltzar 0.5.1");
  await new Promise(resolve => setTimeout(resolve, 100));
  const remainder = document.querySelector(".buchhaltzar__split-table .buchhaltzar__receipt-heading span")?.textContent;
  const nativeConfirm = window.confirm; window.confirm = () => true;
  document.querySelector('.buchhaltzar form button[type="submit"]').click();
  for (let index = 0; index < 30; index++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if ((await plugin.service.snapshot()).transactions.length > before) break;
  }
  window.confirm = nativeConfirm;
  const snapshot = await plugin.service.snapshot();
  const posted = snapshot.transactions.find(transaction => transaction.comment === "E2E TEST Buchhaltzar 0.5.1");

  await attachSyntheticReceipt();
  setValue(document.querySelector('input[placeholder="Необязательно"]'), "MUST BE CLEARED");
  button("Разделить расход").click();
  await new Promise(resolve => setTimeout(resolve, 50));
  setValue(document.querySelector('input[aria-label="Сумма части 1"]'), "5,00");
  button("Убрать").click();
  await new Promise(resolve => setTimeout(resolve, 100));
  const cleared = {
    amount: document.querySelector('input[placeholder="0,00"]')?.value,
    comment: document.querySelector('input[placeholder="Необязательно"]')?.value,
    attachment: Boolean(document.querySelector(".buchhaltzar__attachment")),
    splitPanel: Boolean(document.querySelector(".buchhaltzar__split-table"))
  };

  plugin.settings.ai.enabled = originalEnabled;
  plugin.createAiProvider = originalFactory;
  return JSON.stringify({
    version: plugin.manifest.version, recognized, remainder,
    transactionCountBefore: before, transactionCountAfter: snapshot.transactions.length,
    posted: posted ? { receiptPath: posted.receiptPath, receiptItems: posted.receiptItems?.map(item => ({ name: item.name, amount: item.minorUnits.toString(), accountId: item.accountId })), postings: posted.postings.map(item => ({ accountId: item.accountId, amount: item.minorUnits.toString() })) } : null,
    cleared
  });
})()`);
console.log(JSON.stringify(JSON.parse(result), null, 2));
socket.close();

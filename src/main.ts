import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { BuchhaltzarService, DEFAULT_SETTINGS, type BuchhaltzarSettings } from "./application/service";
import { ObsidianRepository } from "./storage/obsidian-repository";
import { DashboardView, VIEW_TYPE_BUCHHALTZAR } from "./ui/dashboard-view";
import { OpenAiProvider } from "./ai/openai-provider";
import type { AiProvider } from "./ai/types";

export default class BuchhaltzarPlugin extends Plugin {
  settings: BuchhaltzarSettings = DEFAULT_SETTINGS;
  service!: BuchhaltzarService;
  private sessionApiKey = "";

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<BuchhaltzarSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved, ai: { ...DEFAULT_SETTINGS.ai, ...saved?.ai } };
    if (!this.settings.ai.rememberApiKey) delete this.settings.ai.apiKey;
    this.rebuildService();
    await this.service.installBundledContent();
    this.registerView(VIEW_TYPE_BUCHHALTZAR, (leaf) => new DashboardView(leaf, this.service, () => this.createAiProvider(), async (path) => { await this.app.workspace.openLinkText(path, "", true); }));
    this.addRibbonIcon("landmark", "Открыть Buchhaltzar", () => void this.activateView());
    this.addCommand({ id: "open-dashboard", name: "Открыть панель", callback: () => void this.activateView() });
    this.addCommand({ id: "initialize-workspace", name: "Инициализировать область учёта", callback: () => void this.initialize() });
    this.addSettingTab(new BuchhaltzarSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => void this.offerInitialization());
  }

  onunload(): void { this.app.workspace.detachLeavesOfType(VIEW_TYPE_BUCHHALTZAR); }
  rebuildService(): void { this.service = new BuchhaltzarService(new ObsidianRepository(this.app.vault, this.settings.rootFolder), this.settings); }
  setSessionApiKey(value: string): void { this.sessionApiKey = value.trim(); }
  getApiKey(): string { return this.sessionApiKey || this.settings.ai.apiKey || ""; }
  createAiProvider(): AiProvider | null {
    if (!this.settings.ai.enabled) return null;
    try { return new OpenAiProvider(this.settings.ai, this.getApiKey()); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); return null; }
  }

  async initialize(showNotice = true): Promise<void> {
    try { await this.service.initialize(); if (showNotice) new Notice("Область Buchhaltzar готова"); }
    catch (error) { new Notice(`Buchhaltzar: ${error instanceof Error ? error.message : String(error)}`, 7000); }
  }

  async offerInitialization(): Promise<void> {
    try {
      const snapshot = await this.service.snapshot();
      if (!snapshot.accounts.length) new InitializationModal(this.app, async () => { await this.initialize(); await this.activateView(); }).open();
    } catch (error) { new Notice(`Buchhaltzar: ${error instanceof Error ? error.message : String(error)}`, 7000); }
  }

  async activateView(): Promise<void> {
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(VIEW_TYPE_BUCHHALTZAR)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE_BUCHHALTZAR, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); this.rebuildService(); await this.initialize(false); }
}

class InitializationModal extends Modal {
  constructor(app: App, private readonly confirm: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.setTitle("Создать область Buchhaltzar?");
    this.contentEl.createEl("p", { text: "Будут созданы каталоги Accounts, Transactions, Receipts, Reports, Templates, Notes и Settings, а также семь системных счетов. Существующие файлы не изменяются." });
    const controls = this.contentEl.createDiv({ cls: "modal-button-container" });
    controls.createEl("button", { text: "Отмена" }).onclick = () => this.close();
    const create = controls.createEl("button", { text: "Создать", cls: "mod-cta" });
    create.onclick = () => { create.disabled = true; void this.confirm().then(() => this.close()).catch((error) => { create.disabled = false; new Notice(error instanceof Error ? error.message : String(error)); }); };
  }
  onClose(): void { this.contentEl.empty(); }
}

class BuchhaltzarSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BuchhaltzarPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty(); containerEl.createEl("h2", { text: "Buchhaltzar" });
    new Setting(containerEl).setName("Корневой каталог").setDesc("Оставьте пустым для отдельного vault.").addText((text) => text.setPlaceholder("Buchhaltzar").setValue(this.plugin.settings.rootFolder).onChange(async (value) => { this.plugin.settings.rootFolder = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Базовая валюта").addDropdown((dropdown) => dropdown.addOptions({ EUR: "EUR", RUB: "RUB", USD: "USD", CHF: "CHF", GBP: "GBP" }).setValue(this.plugin.settings.baseCurrency).onChange(async (value) => { this.plugin.settings.baseCurrency = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Отрицательный остаток").setDesc("Предупреждать или запрещать проведение.").addDropdown((dropdown) => dropdown.addOptions({ warn: "Предупреждать", block: "Запрещать" }).setValue(this.plugin.settings.negativeBalance).onChange(async (value) => { this.plugin.settings.negativeBalance = value as "warn" | "block"; await this.plugin.saveSettings(); }));
    containerEl.createEl("h3", { text: "ИИ: голос и чеки" });
    containerEl.createEl("p", { text: "Необязательный сетевой слой. Без сети ручной учёт продолжает работать. Голос, текст или выбранная фотография чека отправляются OpenAI только после вашего действия. Распознанный чек допускается в форму лишь после строгой математической проверки." });
    new Setting(containerEl).setName("Включить ИИ").addToggle((toggle) => toggle.setValue(this.plugin.settings.ai.enabled).onChange(async (value) => { this.plugin.settings.ai.enabled = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Провайдер").setDesc("В этой версии реализован адаптер OpenAI; архитектура допускает дополнительные адаптеры.").addDropdown((dropdown) => dropdown.addOption("openai", "OpenAI").setValue(this.plugin.settings.ai.provider));
    new Setting(containerEl).setName("Адрес API").setDesc("Можно изменить для совместимого доверенного шлюза.").addText((text) => text.setValue(this.plugin.settings.ai.baseUrl).onChange(async (value) => { this.plugin.settings.ai.baseUrl = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("API-ключ").setDesc("По умолчанию действует только до закрытия Obsidian.").addText((text) => { text.inputEl.type = "password"; text.setPlaceholder("sk-…").setValue(this.plugin.getApiKey()).onChange(async (value) => { this.plugin.setSessionApiKey(value); if (this.plugin.settings.ai.rememberApiKey) { this.plugin.settings.ai.apiKey = value.trim(); await this.plugin.saveSettings(); } }); });
    new Setting(containerEl).setName("Запомнить ключ на устройстве").setDesc("Ключ будет сохранён открытым текстом в data.json плагина. Не включайте синхронизацию этого файла.").addToggle((toggle) => toggle.setValue(this.plugin.settings.ai.rememberApiKey).onChange(async (value) => { this.plugin.settings.ai.rememberApiKey = value; if (value) this.plugin.settings.ai.apiKey = this.plugin.getApiKey(); else delete this.plugin.settings.ai.apiKey; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Модель текста и чеков").setDesc("Модель должна поддерживать анализ изображений.").addText((text) => text.setValue(this.plugin.settings.ai.textVisionModel).onChange(async (value) => { this.plugin.settings.ai.textVisionModel = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Модель транскрипции").addText((text) => text.setValue(this.plugin.settings.ai.transcriptionModel).onChange(async (value) => { this.plugin.settings.ai.transcriptionModel = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Проверить подключение").addButton((button) => button.setButtonText("Проверить").onClick(async () => { const provider = this.plugin.createAiProvider(); if (!provider) return; button.setDisabled(true); try { await provider.testConnection(); new Notice("Подключение к ИИ работает"); } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 8000); } finally { button.setDisabled(false); } }));
    new Setting(containerEl).setName("Удалить API-ключ").addButton((button) => button.setWarning().setButtonText("Удалить").onClick(async () => { this.plugin.setSessionApiKey(""); delete this.plugin.settings.ai.apiKey; this.plugin.settings.ai.rememberApiKey = false; await this.plugin.saveSettings(); this.display(); new Notice("API-ключ удалён"); }));
  }
}

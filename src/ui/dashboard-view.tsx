import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { BuchhaltzarService } from "../application/service";
import { Dashboard } from "./Dashboard";
import type { AiProvider } from "../ai/types";

export const VIEW_TYPE_BUCHHALTZAR = "buchhaltzar-dashboard";

export class DashboardView extends ItemView {
  private root?: Root;
  constructor(leaf: WorkspaceLeaf, private readonly service: BuchhaltzarService, private readonly getAiProvider: () => AiProvider | null, private readonly openPath: (path: string) => Promise<void>) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_BUCHHALTZAR; }
  getDisplayText(): string { return "Buchhaltzar"; }
  getIcon(): string { return "landmark"; }
  async onOpen(): Promise<void> {
    this.contentEl.empty(); this.contentEl.addClass("buchhaltzar-view");
    this.root = createRoot(this.contentEl); this.root.render(<Dashboard service={this.service} getAiProvider={this.getAiProvider} openPath={this.openPath}/>);
  }
  async onClose(): Promise<void> { this.root?.unmount(); }
}

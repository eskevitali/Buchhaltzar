import { describe, expect, it } from "vitest";
import { createVaultFileIfAbsent, ensureVaultFolder, isAlreadyExistsError } from "../src/storage/vault-write";

class MemoryVault {
  indexed = new Set<string>();
  disk = new Set<string>();
  createdFolders: string[] = [];
  createdFiles: string[] = [];

  getAbstractFileByPath(path: string): { path: string } | null {
    return this.indexed.has(path) ? { path } : null;
  }

  async createFolder(path: string): Promise<void> {
    if (this.disk.has(path)) throw new Error("Folder already exists.");
    this.disk.add(path);
    this.indexed.add(path);
    this.createdFolders.push(path);
  }

  async create(path: string, _content: string): Promise<{ path: string }> {
    if (this.disk.has(path)) throw new Error("File already exists.");
    this.disk.add(path);
    this.indexed.add(path);
    this.createdFiles.push(path);
    return { path };
  }
}

describe("vault writes", () => {
  it("recognizes Obsidian already-exists errors", () => {
    expect(isAlreadyExistsError(new Error("Folder already exists."))).toBe(true);
    expect(isAlreadyExistsError(new Error("File already exists."))).toBe(true);
    expect(isAlreadyExistsError(new Error("permission denied"))).toBe(false);
  });

  it("creates missing folders", async () => {
    const vault = new MemoryVault();
    await ensureVaultFolder(vault, "Notes");
    expect(vault.createdFolders).toEqual(["Notes"]);
  });

  it("skips folders already in the vault index", async () => {
    const vault = new MemoryVault();
    vault.indexed.add("Notes");
    vault.disk.add("Notes");
    await ensureVaultFolder(vault, "Notes");
    expect(vault.createdFolders).toEqual([]);
  });

  it("does not fail when the folder exists on disk but is not indexed yet", async () => {
    const vault = new MemoryVault();
    vault.disk.add("Notes");
    await expect(ensureVaultFolder(vault, "Notes")).resolves.toBeUndefined();
    expect(vault.createdFolders).toEqual([]);
  });

  it("creates nested folders and ignores a race on the parent", async () => {
    const vault = new MemoryVault();
    vault.disk.add("Transactions");
    await ensureVaultFolder(vault, "Transactions/2026/09");
    expect(vault.createdFolders).toEqual(["Transactions/2026", "Transactions/2026/09"]);
  });

  it("does not overwrite an existing file and ignores create races", async () => {
    const vault = new MemoryVault();
    vault.disk.add("Добро пожаловать.md");
    await expect(createVaultFileIfAbsent(vault, "Добро пожаловать.md", "new")).resolves.toBeUndefined();
    expect(vault.createdFiles).toEqual([]);
    await createVaultFileIfAbsent(vault, "Notes/new.md", "ok");
    expect(vault.createdFiles).toEqual(["Notes/new.md"]);
  });
});

export interface FolderVault {
  getAbstractFileByPath(path: string): unknown;
  createFolder(path: string): Promise<unknown>;
}

export interface FileVault {
  getAbstractFileByPath(path: string): unknown;
  create(path: string, content: string): Promise<unknown>;
}

export function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

export async function ensureVaultFolder(vault: FolderVault, path: string): Promise<void> {
  const pieces = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  let current = "";
  for (const piece of pieces) {
    current = current ? `${current}/${piece}` : piece;
    if (vault.getAbstractFileByPath(current)) continue;
    try {
      await vault.createFolder(current);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }
}

export async function createVaultFileIfAbsent(vault: FileVault, path: string, content: string): Promise<void> {
  if (vault.getAbstractFileByPath(path)) return;
  try {
    await vault.create(path, content);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
}

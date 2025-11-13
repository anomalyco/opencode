import fs from "fs/promises"

export async function createBackup(filepath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `${filepath}.bak-${timestamp}`

  if (await Bun.file(filepath).exists()) {
    await fs.copyFile(filepath, backupPath)
  }

  return backupPath
}

export async function restoreBackup(backupPath: string, targetPath: string): Promise<void> {
  await fs.copyFile(backupPath, targetPath)
  await fs.unlink(backupPath)
}

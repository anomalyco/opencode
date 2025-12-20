import { chmod } from "fs/promises"

/**
 * Get file permissions as octal string (e.g., "600", "644")
 * Returns null if file doesn't exist or cannot be read
 */
export async function getFilePermissions(filepath: string): Promise<string | null> {
  const stats = await Bun.file(filepath)
    .stat()
    .catch(() => null)
  if (!stats) return null
  return (stats.mode & 0o777).toString(8)
}

/**
 * Protect a file by setting permissions to 600 (user read/write only)
 * Throws error if file doesn't exist or chmod fails
 */
export async function protectFile(filepath: string): Promise<void> {
  await chmod(filepath, 0o600)
}

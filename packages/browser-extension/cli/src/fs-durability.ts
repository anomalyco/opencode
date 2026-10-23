import { Predicate } from "effect"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const unsupportedDirectorySyncCodes = new Set(["EPERM", "EINVAL", "ENOTSUP"])

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

export function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return isNodeError(error) &&
    Predicate.isString(error.code) &&
    unsupportedDirectorySyncCodes.has(error.code)
}

export async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
  options: { readonly dirMode?: number } = {},
): Promise<void> {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, {
    recursive: true,
    ...(options.dirMode === undefined ? {} : { mode: options.dirMode }),
  })
  if (options.dirMode !== undefined) {
    await fs.chmod(directory, options.dirMode)
  }
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  let renamed = false
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporaryPath, filePath)
    renamed = true
    await fs.chmod(filePath, 0o600)
  } finally {
    if (!renamed) await fs.rm(temporaryPath, { force: true }).catch(() => {})
  }
}

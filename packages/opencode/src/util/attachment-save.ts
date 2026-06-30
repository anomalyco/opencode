import fs from "fs/promises"
import path from "path"
import os from "os"
import { Effect } from "effect"

/**
 * Decode a data URL and save the payload to disk.
 *
 * Returns the saved file path, or `undefined` if:
 * - Disk save is disabled (`save_to_disk === false`)
 * - The write fails (permission denied, disk full, etc.)
 *
 * File path format: `{base}/{sessionID}/{timestamp}-{filename}`
 * Base defaults to `os.tmpdir()/opencode/attachments` when not configured.
 */
export function saveDataUrlToFile(
  url: string,
  cfg: { save_to_disk?: boolean; save_to_disk_path?: string },
  sessionID: string,
): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    if (cfg.save_to_disk === false) return undefined

    const base = cfg.save_to_disk_path ?? path.join(os.tmpdir(), "opencode", "attachments")
    const targetDir = path.join(base, sessionID)

    // Extract filename from the data URL metadata
    const fileName = extractFileName(url) ?? "untitled"
    const safeName = `${Date.now()}-${fileName}`
    const filePath = path.join(targetDir, safeName)

    // Parse base64 payload
    const idx = url.indexOf(",")
    if (idx === -1) return undefined
    const head = url.slice(0, idx)
    const body = url.slice(idx + 1)
    if (!head.includes(";base64")) return undefined

    const buffer = Buffer.from(body, "base64")

    // Write to disk — catch errors gracefully
    const written = yield* writeFileSafe(targetDir, filePath, buffer)
    if (!written) return undefined

    return filePath
  })
}

/**
 * Parse filename from data URL `;name=` parameter or fallback.
 */
function extractFileName(url: string): string | undefined {
  const semicolon = url.indexOf(";")
  if (semicolon === -1) return undefined
  const params = url.slice(semicolon + 1, url.indexOf(","))
  for (const param of params.split(";")) {
    if (param.startsWith("name=")) return decodeURIComponent(param.slice(5))
    if (param.startsWith("filename=")) return decodeURIComponent(param.slice(9))
  }
  return undefined
}

/**
 * Create target directory and write file. Returns true on success, false on error.
 */
function writeFileSafe(
  targetDir: string,
  filePath: string,
  buffer: Buffer,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise(() => fs.mkdir(targetDir, { recursive: true }))
    yield* Effect.tryPromise(() => fs.writeFile(filePath, buffer))
    return true
  }).pipe(
    Effect.catch((error) => {
      console.warn("attachment-save: failed to save attachment to disk", { filePath, error: String(error) })
      return Effect.succeed(false)
    }),
  )
}

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const LC_UUID = 0x1b

/**
 * Replaces the LC_UUID of the thin 64-bit Mach-O `file` with one derived from `seed`, and returns it.
 *
 * Electron ships one main executable per version, so every app on that version has the same LC_UUID. macOS Local
 * Network privacy identifies an app by that UUID, so apps sharing it share one permission (#65751, Apple TN3179).
 * The file must be signed again afterwards.
 */
export async function setMachOUuid(file: string, seed: string) {
  const bytes = await readFile(file)

  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error(`${file} is not a thin 64-bit Mach-O`)
  const uuid = createHash("sha256").update(seed).digest().subarray(0, 16)
  let offset = 32

  for (let index = 0; index < bytes.readUInt32LE(16); index++) {
    const size = bytes.readUInt32LE(offset + 4)

    if (bytes.readUInt32LE(offset) === LC_UUID) {
      uuid.copy(bytes, offset + 8)
      await writeFile(file, bytes)

      return uuid.toString("hex")
    }

    offset += size
  }

  throw new Error(`${file} has no LC_UUID load command`)
}

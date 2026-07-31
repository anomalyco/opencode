import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { sanitize } from "./sanitize"

export async function appendFallbackDiagnostic(path: string, diagnostic: unknown, secrets: readonly string[]) {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, JSON.stringify(sanitize(diagnostic, secrets)) + "\n", "utf8")
}

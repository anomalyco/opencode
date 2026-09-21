import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { base64Encode } from "@opencode/util/encode"
import type { Reporter } from "@playwright/test/reporter"

export default class CredentialArtifactReporter implements Reporter {
  async onEnd() {
    const password = process.env.EXECUTION_E2E_PASSWORD
    if (password === undefined || password === "") return
    const encoded = base64Encode(`opencode:${password}`)
    const roots = [
      fileURLToPath(new URL("../test-results", import.meta.url)),
      fileURLToPath(new URL("../playwright-report", import.meta.url)),
    ]
    const leaked: string[] = []
    let scanned = 0
    for (const root of roots) {
      for (const file of await listFiles(root)) {
        scanned += 1
        const content = await readFile(file)
        if (content.includes(password) || content.includes(encoded)) leaked.push(file)
      }
    }
    if (leaked.length > 0) {
      throw new Error(`execution credential leaked into retained artifacts: ${leaked.join(", ")}`)
    }
    if (scanned === 0) {
      throw new Error("execution credential artifact scan found no retained artifacts to verify")
    }
    process.stdout.write(`execution credential artifact scan: clean (${scanned} files)\n`)
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? listFiles(path.join(root, entry.name)) : Promise.resolve([path.join(root, entry.name)]),
    ),
  )
  return nested.flat()
}

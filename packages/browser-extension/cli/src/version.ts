import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

declare global {
  // Injected by scripts/build-cli.ts at build time.
  var __OPENCODE_BROWSER_VERSION__: string | undefined
  var __OPENCODE_BROWSER_BUILD_ID__: string | undefined
}

export const opencodeBrowserVersion: string = globalThis.__OPENCODE_BROWSER_VERSION__ ?? "0.0.0-dev"
export const opencodeBrowserBuildId: string = globalThis.__OPENCODE_BROWSER_BUILD_ID__ ?? sourceBuildId()

export function sourceBuildIdForFiles(files: readonly { readonly name: string; readonly content: string | Buffer }[]): string {
  const hash = crypto.createHash("sha256")
  for (const file of [...files].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    hash.update(file.name)
    hash.update("\0")
    hash.update(file.content)
    hash.update("\0")
  }
  return `source-${hash.digest("hex").slice(0, 16)}`
}

function sourceBuildId(): string {
  const srcDir = path.dirname(fileURLToPath(import.meta.url))
  const rootDir = path.join(srcDir, "..")
  const files = fs.readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => ({ name: `src/${entry.name}`, content: fs.readFileSync(path.join(srcDir, entry.name)) }))
  for (const name of ["package.json", "bun.lock"]) {
    const file = path.join(rootDir, name)
    if (fs.existsSync(file)) files.push({ name, content: fs.readFileSync(file) })
  }
  return sourceBuildIdForFiles(files)
}

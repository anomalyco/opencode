/**
 * Reads packages/opencode/config-defaults/** and emits
 * src/config/default-assets.json — a { relativePath: content } map that is
 * embedded into the binary and seeded into the user's global config dir on
 * first run (see src/config/provision.ts).
 *
 * Run: bun run script/gen-default-config.ts
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "fs"
import path from "path"

const root = path.join(import.meta.dir, "..", "config-defaults")
const outFile = path.join(import.meta.dir, "..", "src", "config", "default-assets.json")

function walk(dir: string, base: string, acc: Record<string, string>) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry)
    if (statSync(abs).isDirectory()) {
      walk(abs, base, acc)
      continue
    }
    const rel = path.relative(base, abs).split(path.sep).join("/")
    acc[rel] = readFileSync(abs, "utf8")
  }
}

const assets: Record<string, string> = {}
walk(root, root, assets)

const sorted = Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(outFile, JSON.stringify(sorted, null, 2) + "\n", "utf8")
console.log(`Wrote ${Object.keys(sorted).length} default config assets to ${outFile}`)
for (const k of Object.keys(sorted)) console.log("  -", k)

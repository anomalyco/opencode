import path from "node:path"
import { extraLocaleKeysAllowlist } from "./i18n-check-allowlist"
import { i18nDir, i18nFile, selected } from "./i18n-common"

const basePath = path.join(i18nDir, "en.json")
if (!(await Bun.file(basePath).exists())) {
  console.error(`Missing base dictionary: ${basePath}`)
  process.exit(1)
}

const base = (await Bun.file(basePath).json()) as Record<string, string>
const baseKey = new Set(Object.keys(base))
const target = selected()
const errors: string[] = []

for (const code of target) {
  const file = path.join(i18nDir, `${i18nFile(code)}.json`)
  if (!(await Bun.file(file).exists())) {
    errors.push(`missing file: src/content/i18n/${i18nFile(code)}.json`)
    continue
  }

  const data = (await Bun.file(file).json()) as Record<string, string>
  const key = new Set(Object.keys(data))
  const missing = [...baseKey].filter((item) => !key.has(item))
  const allowed = new Set(extraLocaleKeysAllowlist[code] ?? [])
  const extra = [...key].filter((item) => !baseKey.has(item) && !allowed.has(item))

  if (missing.length > 0) {
    errors.push(`missing keys in ${i18nFile(code)}.json: ${missing.join(", ")}`)
  }
  if (extra.length > 0) {
    errors.push(
      `extra keys in ${i18nFile(code)}.json: ${extra.join(", ")} (remove keys or allowlist sanctioned extras in scripts/i18n-check-allowlist.ts)`,
    )
  }
}

if (errors.length === 0) {
  console.log(`i18n key parity OK for ${target.length} locales.`)
  process.exit(0)
}

console.error("i18n key parity failed:")
for (const error of errors) {
  console.error(`- ${error}`)
}
process.exit(1)

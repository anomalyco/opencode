import { readdirSync } from "fs"

const LOCALES = ["zh","zht","ko","de","es","fr","da","ja","pl","ru","ar","no","br","th","bs","tr"]

export async function findAllLocaleFiles(cwd: string, pattern: string) {
  const dir = cwd + "/packages/app/src/i18n/"
  const files = readdirSync(dir).filter(f => f.endsWith(".ts") && f !== "en.ts" && f !== "parity.test.ts")
  const paths = files.map(f => dir + f)
  const results = []
  for (const path of paths) {
    const name = path.split("/").pop().replace(".ts", "")
    if (!name || name === "en" || name === "parity") continue
    if (!LOCALES.includes(name)) continue
    const content = await Bun.file(path).text()
    const dict = parseDict(content)
    results.push({ path: path, locale: name, keys: new Set(Object.keys(dict)), dict: dict })
  }
  return results
}

export async function loadSource(cwd, source) {
  const path = cwd + "/packages/app/src/i18n/" + source + ".ts"
  const content = await Bun.file(path).text()
  const dict = parseDict(content)
  return { path: path, locale: source, keys: new Set(Object.keys(dict)), dict: dict }
}

export function parseDict(content) {
  const dict: Record<string, string> = {}
  const withoutExport = content.replace(/export const dict = \{/, "").replace(/\n\}$/, "")
  const lines = withoutExport.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === ",") continue
    const keyMatch = trimmed.match(/^"([^"]+)":\s*"([^"]*)",?/)
    if (keyMatch) {
      dict[keyMatch[1]] = keyMatch[2]
    }
  }
  return dict
}

export function findMissing(source, target) {
  const missing = []
  for (const key of source.keys) {
    if (!target.keys.has(key)) missing.push(key)
  }
  return missing.sort()
}

export async function checkKeys(cwd, source) {
  const src = await loadSource(cwd, source)
  const reports = []
  const targets = await findAllLocaleFiles(cwd, "packages/app/src/i18n/*.ts")
  for (const target of targets) {
    const missing = findMissing(src, target)
    reports.push({ locale: target.locale, path: target.path, missing, count: missing.length })
  }
  return reports.sort((a, b) => a.locale.localeCompare(b.locale))
}
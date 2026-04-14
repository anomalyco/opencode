import { parseDict, loadSource, findAllLocaleFiles, findMissing } from "./detect"
import type { SyncResult } from "./types"

export async function fillKeys(
  cwd: string,
  source: string,
  locale: string,
  dryRun: boolean,
  verbose: boolean,
) {
  const src = await loadSource(cwd, source)
  const targetPath = cwd + "/packages/app/src/i18n/" + locale + ".ts"
  const original = await Bun.file(targetPath).text()
  const target = parseDict(original)
  const targetKeys = new Set(Object.keys(target))
  const missing = findMissing(src, { path: targetPath, locale, keys: targetKeys, dict: target })

  const result: SyncResult = {
    locale,
    path: targetPath,
    added: 0,
    skipped: 0,
    errors: [],
  }

  if (missing.length === 0) {
    if (verbose) console.log("[" + locale + "] No missing keys")
    return result
  }

  if (verbose) console.log("[" + locale + "] Found " + missing.length + " missing keys")

  for (const key of missing) {
    if (!target[key]) {
      target[key] = src.dict[key]
      result.added++
    } else {
      result.skipped++
    }
  }

  if (!dryRun) {
    const newContent = addKeysToFile(original, missing, src.dict)
    await Bun.write(targetPath, newContent)
    if (verbose) console.log("[" + locale + "] Written " + result.added + " keys")
  } else {
    if (verbose) console.log("[" + locale + "] Dry run - would add " + result.added + " keys")
  }

  return result
}

function addKeysToFile(original: string, missing: string[], dict: Record<string, string>) {
  const addKeys = missing.filter(k => dict[k] !== undefined)
  if (addKeys.length === 0) return original
  const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const lines = original.split("\n")
  let insertIndex = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === "}" || line === "}") {
      insertIndex = i
      break
    }
  }
  const beforeInsert = lines.slice(0, insertIndex)
  const afterInsert = lines.slice(insertIndex)
  if (beforeInsert.length > 0) {
    const lastReal = beforeInsert[beforeInsert.length - 1].trim()
    if (lastReal && !lastReal.endsWith(",")) {
      beforeInsert[beforeInsert.length - 1] += ","
    }
  }
  const newKeys = addKeys.map(k => '  "' + k + '": "' + escape(dict[k]) + '",')
  newKeys[newKeys.length - 1] = newKeys[newKeys.length - 1].replace(/,$/, "")
  const result = [...beforeInsert, ...newKeys, ...afterInsert]
  return result.join("\n")
}

export async function fillAllKeys(
  cwd: string,
  source: string,
  dryRun: boolean,
  verbose: boolean,
) {
  const results: SyncResult[] = []
  const targets = await findAllLocaleFiles(cwd, "packages/app/src/i18n/*.ts")
  for (const target of targets) {
    const result = await fillKeys(cwd, source, target.locale, dryRun, verbose)
    results.push(result)
  }
  return results
}
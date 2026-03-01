import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.legacy" })

type LegacyConfig = {
  files: Array<{ path: string; format: "json" | "jsonc" | "yaml" | "toml"; scope: "global" | "project" }>
  migrate: (raw: unknown) => Record<string, unknown>
}

type ScopedUpdates = {
  global: Record<string, Record<string, unknown>>
  project: Record<string, Record<string, unknown>>
}

async function parseFile(path: string, format: "json" | "jsonc" | "yaml" | "toml"): Promise<unknown> {
  const f = Bun.file(path)
  if (!(await f.exists())) return undefined
  const text = await f.text()
  if (format === "jsonc" || format === "json") {
    const errors: ParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
      const msg = errors.map((e) => `code=${e.error} offset=${e.offset}`).join(", ")
      throw new Error(`JSONC parse errors: ${msg}`)
    }
    return data
  }
  // yaml/toml: fallback to JSON parse (unsupported formats treated as JSON)
  return JSON.parse(text)
}

export async function discoverLegacyConfigs(
  hooks: { id: string; legacyConfig: LegacyConfig }[],
  existingSettings: Record<string, Record<string, unknown>>,
): Promise<ScopedUpdates> {
  const result: ScopedUpdates = { global: {}, project: {} }

  for (const { id, legacyConfig } of hooks) {
    const existing = existingSettings[id] ?? {}
    if (Object.keys(existing).length > 0) continue

    for (const file of legacyConfig.files) {
      let raw: unknown
      try {
        raw = await parseFile(file.path, file.format)
      } catch {
        log.warn("legacyConfig: failed to parse file", { path: file.path, plugin: id })
        continue
      }
      if (raw === undefined) continue

      try {
        const migrated = legacyConfig.migrate(raw)
        result[file.scope][id] = migrated
        break
      } catch {
        log.warn("legacyConfig: migrate() threw for file", { path: file.path, plugin: id })
      }
    }
  }

  return result
}

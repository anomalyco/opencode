import path from "path"
import { type ParseError as JsoncParseError, applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { unique } from "remeda"
import { Option, Schema } from "effect"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import * as ConfigPaths from "@/config/paths"

const TUI_SCHEMA_URL = "https://opencode.ai/tui.json"

const decodeTheme = Schema.decodeUnknownOption(Schema.String)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const decodeScrollSpeed = Schema.decodeUnknownOption(TuiConfig.ScrollSpeed)
const decodeScrollAcceleration = Schema.decodeUnknownOption(TuiConfig.ScrollAcceleration)
const decodeDiffStyle = Schema.decodeUnknownOption(TuiConfig.DiffStyle)

interface MigrateInput {
  cwd: string
  directories: string[]
}

/**
 * Migrates tui-specific keys (theme, keybinds, tui) from opencode.json files
 * into dedicated tui.json files. Migration is performed per-directory and
 * skips only locations where a tui.json already exists.
 */
export async function migrateTuiConfig(input: MigrateInput) {
  const opencode = await opencodeFiles(input)
  for (const file of opencode) {
    const source = await Filesystem.readText(file).catch(() => undefined)
    if (!source) continue
    const errors: JsoncParseError[] = []
    const data = parseJsonc(source, errors, { allowTrailingComma: true })
    if (errors.length || !data || typeof data !== "object" || Array.isArray(data)) continue

    const theme = decodeTheme("theme" in data ? data.theme : undefined)
    const keybinds = decodeRecord("keybinds" in data ? data.keybinds : undefined)
    const legacyTui = decodeRecord("tui" in data ? data.tui : undefined)
    const extracted = {
      theme: Option.getOrUndefined(theme),
      keybinds: Option.getOrUndefined(keybinds),
      tui: Option.getOrUndefined(legacyTui),
    }
    const tui = extracted.tui ? normalizeTui(extracted.tui) : undefined
    if (extracted.theme === undefined && extracted.keybinds === undefined && !tui) continue

    const target = path.join(path.dirname(file), "tui.json")
    const targetExists = await Filesystem.exists(target)
    if (targetExists) continue

    const payload: Record<string, unknown> = {
      $schema: TUI_SCHEMA_URL,
    }
    if (extracted.theme !== undefined) payload.theme = extracted.theme
    if (extracted.keybinds !== undefined) payload.keybinds = extracted.keybinds
    if (tui) Object.assign(payload, tui)

    const wrote = await Filesystem.write(target, JSON.stringify(payload, null, 2))
      .then(() => true)
      .catch(() => false)
    if (!wrote) continue

    const stripped = await backupAndStripLegacy(file, source)
    if (!stripped) continue
  }
}

function normalizeTui(data: Record<string, unknown>):
  | {
      scroll_speed: number | undefined
      scroll_acceleration: { enabled: boolean } | undefined
      diff_style: "auto" | "stacked" | undefined
    }
  | undefined {
  const parsed = {
    scroll_speed: Option.getOrUndefined(decodeScrollSpeed(data.scroll_speed)),
    scroll_acceleration: Option.getOrUndefined(decodeScrollAcceleration(data.scroll_acceleration)),
    diff_style: Option.getOrUndefined(decodeDiffStyle(data.diff_style)),
  }
  return parsed.scroll_speed === undefined &&
    parsed.diff_style === undefined &&
    parsed.scroll_acceleration === undefined
    ? undefined
    : parsed
}

async function backupAndStripLegacy(file: string, source: string) {
  const backup = file + ".tui-migration.bak"
  const hasBackup = await Filesystem.exists(backup)
  const backed = hasBackup
    ? true
    : await Filesystem.write(backup, source)
        .then(() => true)
        .catch(() => false)
  if (!backed) return false

  const text = ["theme", "keybinds", "tui"].reduce((acc, key) => {
    const edits = modify(acc, [key], undefined, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    if (!edits.length) return acc
    return applyEdits(acc, edits)
  }, source)

  return Filesystem.write(file, text)
    .then(() => true)
    .catch(() => false)
}

async function opencodeFiles(input: { directories: string[]; cwd: string }) {
  const files = [
    ...ConfigPaths.fileInDirectory(Global.Path.config, "opencode"),
    ...(await Filesystem.findUp(["opencode.json", "opencode.jsonc"], input.cwd, undefined, { rootFirst: true })),
  ]
  for (const dir of unique(input.directories)) {
    files.push(...ConfigPaths.fileInDirectory(dir, "opencode"))
  }
  if (Flag.OPENCODE_CONFIG) files.push(Flag.OPENCODE_CONFIG)

  const existing = await Promise.all(
    unique(files).map(async (file) => {
      const ok = await Filesystem.exists(file)
      return ok ? file : undefined
    }),
  )
  return existing.filter((file): file is string => !!file)
}

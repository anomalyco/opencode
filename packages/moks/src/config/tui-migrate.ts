import path from "path"
import { type ParseError as JsoncParseError, applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { unique } from "remeda"
import { Option, Schema } from "effect"
import { TuiConfig } from "@moks/tui/config"
import { Flag } from "@moks/core/flag/flag"
import { Global } from "@moks/core/global"
import { Filesystem } from "@/util/filesystem"
import * as ConfigPaths from "@/config/paths"

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
 * Migrates tui-specific keys (theme, keybinds, tui) from opencode.json / moks.json
 * files into dedicated tui.json files. Migration is performed per-directory and
 * skips only locations where a tui.json already exists.
 *
 * When multiple config files in the same directory carry legacy keys, they are
 * merged in CONFIG_FILE_NAMES order (opencode then moks) so moks wins, then
 * every contributor is stripped after a successful write.
 */
export async function migrateTuiConfig(input: MigrateInput) {
  const sources = await projectConfigFiles(input)
  const byDir = new Map<string, string[]>()
  for (const file of sources) {
    const dir = path.dirname(file)
    const list = byDir.get(dir)
    if (!list) {
      byDir.set(dir, [file])
      continue
    }
    list.push(file)
  }

  for (const [dir, files] of byDir) {
    const target = path.join(dir, "tui.json")
    if (await Filesystem.exists(target)) continue

    const ordered = files.toSorted((a, b) => configFileRank(a) - configFileRank(b))
    let theme: string | undefined
    let keybinds: Record<string, unknown> | undefined
    let tui:
      | {
          scroll_speed: number | undefined
          scroll_acceleration: { enabled: boolean } | undefined
          diff_style: "auto" | "stacked" | undefined
        }
      | undefined
    const contributors: { file: string; source: string }[] = []

    for (const file of ordered) {
      const source = await Filesystem.readText(file).catch(() => undefined)
      if (!source) continue
      const errors: JsoncParseError[] = []
      const data = parseJsonc(source, errors, { allowTrailingComma: true })
      if (errors.length || !data || typeof data !== "object" || Array.isArray(data)) continue

      const nextTheme = Option.getOrUndefined(decodeTheme("theme" in data ? data.theme : undefined))
      const nextKeybinds = Option.getOrUndefined(decodeRecord("keybinds" in data ? data.keybinds : undefined))
      const legacyTui = Option.getOrUndefined(decodeRecord("tui" in data ? data.tui : undefined))
      const nextTui = legacyTui ? normalizeTui(legacyTui) : undefined
      if (nextTheme === undefined && nextKeybinds === undefined && !nextTui) continue

      // Later files (moks after opencode) overwrite earlier keys.
      if (nextTheme !== undefined) theme = nextTheme
      if (nextKeybinds !== undefined) keybinds = nextKeybinds
      if (nextTui) {
        tui = {
          scroll_speed: nextTui.scroll_speed ?? tui?.scroll_speed,
          scroll_acceleration: nextTui.scroll_acceleration ?? tui?.scroll_acceleration,
          diff_style: nextTui.diff_style ?? tui?.diff_style,
        }
      }
      contributors.push({ file, source })
    }

    if (!contributors.length) continue
    if (theme === undefined && keybinds === undefined && !tui) continue

    const payload: Record<string, unknown> = {}
    if (theme !== undefined) payload.theme = theme
    if (keybinds !== undefined) payload.keybinds = keybinds
    if (tui) Object.assign(payload, tui)

    const wrote = await Filesystem.write(target, JSON.stringify(payload, null, 2))
      .then(() => true)
      .catch(() => false)
    if (!wrote) continue

    for (const item of contributors) {
      await backupAndStripLegacy(item.file, item.source)
    }
  }
}

function configFileRank(file: string) {
  const name = path.basename(file)
  const index = (ConfigPaths.CONFIG_FILE_NAMES as readonly string[]).indexOf(name)
  return index === -1 ? ConfigPaths.CONFIG_FILE_NAMES.length : index
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

async function projectConfigFiles(input: { directories: string[]; cwd: string }) {
  const files = [
    ...ConfigPaths.configFilesInDirectory(Global.Path.config),
    ...(await Filesystem.findUp([...ConfigPaths.CONFIG_FILE_NAMES], input.cwd, undefined, { rootFirst: true })),
  ]
  for (const dir of unique(input.directories)) {
    files.push(...ConfigPaths.configFilesInDirectory(dir))
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

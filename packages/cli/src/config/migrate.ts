export * as ConfigMigration from "./migrate"

import { TuiConfigV1 } from "@opencode-ai/tui/config/v1"
import { TuiKeybind } from "@opencode-ai/tui/config/v1/keybind"
import { Definitions } from "@opencode-ai/tui/config/keybind"
import { Effect, FileSystem, Option, Schema } from "effect"
import { randomUUID } from "crypto"
import { applyEdits, createScanner, modify, parse, parseTree, type Node, type ParseError } from "jsonc-parser"
import path from "path"
import { Info } from "./schema"

const decodeV1 = Schema.decodeUnknownOption(TuiConfigV1.Info)
const decodeInfo = Schema.decodeUnknownOption(Info)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Any))
const LegacyKeybindTargets = new Set<string>(Object.values(TuiKeybind.CommandMap))

export const run = Effect.fn("cli.config.migrate")(function* (input: {
  readonly file: string
  readonly config: string
  readonly state: string
}) {
  const fs = yield* FileSystem.FileSystem
  const persist = Effect.fnUntraced(function* (text: string, info: Info) {
    const temp = `${input.file}.${process.pid}.${randomUUID()}.tmp`
    const cause = yield* Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(input.file), { recursive: true })
      yield* fs.writeFileString(temp, text, { mode: 0o600 })
      yield* fs.rename(temp, input.file)
    }).pipe(
      Effect.as(undefined),
      Effect.catchCause((cause) => Effect.succeed(cause)),
      Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)),
    )
    return cause === undefined ? { info } : { info, cause }
  })

  if (yield* fs.exists(input.file).pipe(Effect.orElseSucceed(() => false))) {
    const text = yield* fs.readFileString(input.file)
    const errors: ParseError[] = []
    const value: any = parse(text, errors, { allowTrailingComma: true })
    if (errors.length) return
    const config = Option.getOrUndefined(decodeRecord(value))
    if (config === undefined) return
    const terminal = Option.getOrUndefined(decodeRecord(config.terminal))
    const legacyCopy = terminal?.copy_on_select
    const copy =
      typeof legacyCopy === "boolean" && terminal?.copy === undefined ? (legacyCopy ? "select" : "manual") : undefined
    const renamed =
      typeof legacyCopy !== "boolean"
        ? text
        : [
            ...(copy === undefined ? [] : [{ path: ["terminal", "copy"], value: copy }]),
            { path: ["terminal", "copy_on_select"], value: undefined },
          ].reduce(
            (text, edit) =>
              applyEdits(
                text,
                modify(text, edit.path, edit.value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
              ),
            text,
          )
    const keybinds = Option.getOrUndefined(decodeRecord(config.keybinds))
    const updated =
      keybinds === undefined
        ? renamed
        : Object.keys(keybinds).reduce(
            (text, name) => {
              const target =
                TuiKeybind.CommandMap[name as keyof typeof TuiKeybind.CommandMap] ??
                (name in Definitions || LegacyKeybindTargets.has(name) ? name : undefined)
              if (target === undefined) return text
              const properties = findKeybindProperties(text, name)
              if (!properties.length) return text
              const remove = !(target in Definitions) || (target !== name && target in keybinds)
              // The parser gives the final duplicate precedence, so remove earlier properties before renaming it.
              const cleaned = properties.slice(0, remove ? properties.length : -1).reduce((text) => {
                const property = findKeybindProperties(text, name)[0]
                return property === undefined ? text : removeProperty(text, property)
              }, text)
              if (remove) return cleaned
              if (target === name) return cleaned
              const key = findKeybindProperties(cleaned, name)[0]?.children?.[0]
              if (key === undefined) return text
              return cleaned.slice(0, key.offset) + JSON.stringify(target) + cleaned.slice(key.offset + key.length)
            },
            findKeybindObjects(renamed)
              .slice(0, -1)
              .reduce((text) => {
                const property = findKeybindObjects(text)[0]
                return property === undefined ? text : removeProperty(text, property)
              }, renamed),
          )
    if (updated === text) return
    const updatedErrors: ParseError[] = []
    const info = Option.getOrUndefined(decodeInfo(parse(updated, updatedErrors, { allowTrailingComma: true })))
    if (updatedErrors.length || info === undefined) return
    return yield* persist(updated, info)
  }

  const legacyValue = yield* readJson(path.join(input.config, "tui.json"))
  const legacy = Option.getOrUndefined(decodeV1(legacyValue))
  const kv = yield* readJson(path.join(input.state, "kv.json"))
  const migrated = migrateV1(legacy, kv ?? {})
  if (!Object.keys(migrated).length) return

  const result = yield* persist(JSON.stringify(migrated, null, 2) + "\n", migrated)
  if (result.cause === undefined)
    yield* Effect.logInfo("migrated cli config", {
      from: [
        legacyValue === undefined ? undefined : path.join(input.config, "tui.json"),
        kv === undefined ? undefined : path.join(input.state, "kv.json"),
      ].filter(Boolean),
      to: input.file,
    })
  return result
})

function findKeybindProperties(text: string, name: string) {
  const keybinds = findKeybindObjects(text).at(-1)?.children?.[1]
  return keybinds?.children?.filter((property) => property.children?.[0]?.value === name) ?? []
}

function findKeybindObjects(text: string) {
  const tree = parseTree(text)
  if (tree === undefined) return []
  return tree.children?.filter((property) => property.children?.[0]?.value === "keybinds") ?? []
}

function removeProperty(text: string, property: Node) {
  const properties = property.parent?.children ?? []
  const index = properties.indexOf(property)
  const end = property.offset + property.length
  const next = properties[index + 1]
  if (next) {
    const comma = findComma(text, end, next.offset)
    if (comma !== undefined) return text.slice(0, property.offset) + text.slice(end, comma) + text.slice(comma + 1)
  }
  const previous = properties[index - 1]
  if (previous) {
    const comma = findComma(text, previous.offset + previous.length, property.offset)
    if (comma !== undefined) return text.slice(0, comma) + text.slice(comma + 1, property.offset) + text.slice(end)
  }
  const comma = findComma(text, end, (property.parent?.offset ?? 0) + (property.parent?.length ?? 0))
  if (comma !== undefined) return text.slice(0, property.offset) + text.slice(end, comma) + text.slice(comma + 1)
  return text.slice(0, property.offset) + text.slice(end)
}

function findComma(text: string, start: number, end: number) {
  const scanner = createScanner(text, false)
  scanner.setPosition(start)
  while (true) {
    scanner.scan()
    const offset = scanner.getTokenOffset()
    if (scanner.getTokenLength() === 0 || offset >= end) return
    if (text[offset] === ",") return offset
  }
}

export function migrateV1(legacy: TuiConfigV1.Info | undefined, kv: Record<string, any>): Info {
  const plugins = [
    ...(legacy?.plugin?.map((plugin) =>
      typeof plugin === "string" ? plugin : { package: plugin[0], options: plugin[1] },
    ) ?? []),
    ...Object.entries(legacy?.plugin_enabled ?? {}).map(([id, enabled]) => (enabled ? id : `-${id}`)),
  ]
  const themeName = legacy?.theme ?? kv.theme
  const themeMode = kv.theme_mode_lock
  const attentionSoundPack = kv.attention_sound_pack
  const diffView = kv.diff_viewer_view ?? (legacy?.diff_style === "stacked" ? "unified" : undefined)
  const thinking =
    kv.thinking_mode ?? (kv.thinking_visibility === undefined ? undefined : kv.thinking_visibility ? "show" : "hide")
  const keybinds =
    legacy?.keybinds === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(legacy.keybinds).flatMap(([name, value]) => {
            const target = TuiKeybind.CommandMap[name as keyof typeof TuiKeybind.CommandMap] ?? name
            if (!(target in Definitions)) return []
            return [[target, value]]
          }),
        )

  return {
    ...(themeName !== undefined || themeMode !== undefined
      ? {
          theme: {
            ...(themeName === undefined ? {} : { name: themeName }),
            ...(themeMode === undefined ? {} : { mode: themeMode }),
          },
        }
      : {}),
    ...(keybinds === undefined ? {} : { keybinds }),
    ...(plugins.length ? { plugins } : {}),
    ...(legacy?.leader_timeout === undefined ? {} : { leader: { timeout: legacy.leader_timeout } }),
    ...(legacy?.scroll_speed === undefined && legacy?.scroll_acceleration?.enabled === undefined
      ? {}
      : {
          scroll: {
            ...(legacy.scroll_speed === undefined ? {} : { speed: legacy.scroll_speed }),
            ...(legacy.scroll_acceleration?.enabled === undefined
              ? {}
              : { acceleration: legacy.scroll_acceleration.enabled }),
          },
        }),
    ...(legacy?.attention === undefined && attentionSoundPack === undefined
      ? {}
      : {
          attention: {
            ...legacy?.attention,
            ...(attentionSoundPack === undefined ? {} : { sound_pack: attentionSoundPack }),
          },
        }),
    ...(legacy?.diff_style === undefined &&
    kv.diff_wrap_mode === undefined &&
    kv.diff_viewer_show_file_tree === undefined &&
    kv.diff_viewer_single_patch === undefined &&
    diffView === undefined
      ? {}
      : {
          diffs: {
            ...(kv.diff_wrap_mode === undefined ? {} : { wrap: kv.diff_wrap_mode }),
            ...(kv.diff_viewer_show_file_tree === undefined ? {} : { tree: kv.diff_viewer_show_file_tree }),
            ...(kv.diff_viewer_single_patch === undefined ? {} : { single: kv.diff_viewer_single_patch }),
            ...(diffView === undefined ? {} : { view: diffView }),
          },
        }),
    ...(kv.terminal_title_enabled === undefined ? {} : { terminal: { title: kv.terminal_title_enabled } }),
    ...(kv.file_context_enabled === undefined && kv.paste_summary_enabled === undefined
      ? {}
      : {
          prompt: {
            ...(kv.file_context_enabled === undefined ? {} : { editor: kv.file_context_enabled }),
            ...(kv.paste_summary_enabled === undefined
              ? {}
              : { paste: kv.paste_summary_enabled ? ("compact" as const) : ("full" as const) }),
          },
        }),
    ...(kv.sidebar === undefined &&
    kv.scrollbar_visible === undefined &&
    thinking === undefined &&
    kv.exploration_grouping === undefined
      ? {}
      : {
          session: {
            ...(kv.sidebar === undefined ? {} : { sidebar: kv.sidebar }),
            ...(kv.scrollbar_visible === undefined ? {} : { scrollbar: kv.scrollbar_visible }),
            ...(thinking === undefined ? {} : { thinking }),
            ...(kv.exploration_grouping === undefined
              ? {}
              : { grouping: kv.exploration_grouping ? ("auto" as const) : ("none" as const) }),
          },
        }),
    ...(kv.animations_enabled === undefined ? {} : { animations: kv.animations_enabled }),
    ...(legacy?.mouse === undefined ? {} : { mouse: legacy.mouse }),
    ...(legacy?.cursor === undefined ? {} : { cursor: legacy.cursor }),
  }
}

const readJson = Effect.fnUntraced(function* (target: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => undefined))
  if (text === undefined) return undefined
  const errors: ParseError[] = []
  const value: any = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) return undefined
  return Option.getOrUndefined(decodeRecord(value))
})

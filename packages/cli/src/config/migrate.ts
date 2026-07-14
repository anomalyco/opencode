export * as ConfigMigration from "./migrate"

import { TuiConfigV1 } from "@opencode-ai/tui/config/v1"
import { Effect, FileSystem, Option, Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import path from "path"
import type { Info } from "./schema"

const decodeV1 = Schema.decodeUnknownOption(TuiConfigV1.Info)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Any))

export const run = Effect.fn("cli.config.migrate")(function* (input: {
  readonly file: string
  readonly config: string
  readonly state: string
}) {
  const fs = yield* FileSystem.FileSystem
  if (yield* fs.exists(input.file).pipe(Effect.orElseSucceed(() => false))) return

  const legacyValue = yield* readJson(path.join(input.config, "tui.json"))
  const legacy = Option.getOrUndefined(decodeV1(legacyValue))
  const kv = yield* readJson(path.join(input.state, "kv.json"))
  const migrated = migrateV1(legacy, kv ?? {})
  if (!Object.keys(migrated).length) return

  const temp = input.file + ".tmp"
  yield* fs.makeDirectory(path.dirname(input.file), { recursive: true })
  yield* fs.writeFileString(temp, JSON.stringify(migrated, null, 2) + "\n", { mode: 0o600 })
  yield* fs.rename(temp, input.file)
  yield* Effect.logInfo("migrated cli config", {
    from: [
      legacyValue === undefined ? undefined : path.join(input.config, "tui.json"),
      kv === undefined ? undefined : path.join(input.state, "kv.json"),
    ].filter(Boolean),
    to: input.file,
  })
})

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
    kv.thinking_mode ??
    (kv.thinking_visibility === undefined ? undefined : kv.thinking_visibility ? "show" : "hide")

  return {
    ...(themeName !== undefined || themeMode !== undefined
      ? { theme: { ...(themeName === undefined ? {} : { name: themeName }), ...(themeMode === undefined ? {} : { mode: themeMode }) } }
      : {}),
    ...(legacy?.keybinds === undefined ? {} : { keybinds: legacy.keybinds }),
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
    ...(kv.tips_hidden === undefined && kv.dismissed_getting_started === undefined
      ? {}
      : {
          hints: {
            ...(kv.tips_hidden === undefined ? {} : { tips: !kv.tips_hidden }),
            ...(kv.dismissed_getting_started === undefined
              ? {}
              : { onboarding: !kv.dismissed_getting_started }),
          },
        }),
    ...(kv.animations_enabled === undefined ? {} : { animations: kv.animations_enabled }),
    ...(legacy?.mouse === undefined ? {} : { mouse: legacy.mouse }),
  }
}

const readJson = Effect.fnUntraced(function* (target: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (text === undefined) return undefined
  const errors: ParseError[] = []
  const value: any = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) return undefined
  return Option.getOrUndefined(decodeRecord(value))
})

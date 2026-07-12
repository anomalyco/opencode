export * as TuiConfigV2 from "."

import { Schema } from "effect"
import { TuiKeybind } from "./keybind"

export const Plugin = Schema.Union([
  Schema.String,
  Schema.Struct({
    package: Schema.String,
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  }),
])

export const Info = Schema.Struct({
  theme: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      mode: Schema.optional(Schema.Literals(["system", "dark", "light"])),
    }),
  ),
  keybinds: Schema.optional(TuiKeybind.KeybindOverrides),
  plugins: Schema.optional(Schema.Array(Plugin)),
  leader: Schema.optional(
    Schema.Struct({
      timeout: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    }),
  ),
  scroll: Schema.optional(
    Schema.Struct({
      speed: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.001))),
      acceleration: Schema.optional(Schema.Boolean),
    }),
  ),
  attention: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      notifications: Schema.optional(Schema.Boolean),
      sound: Schema.optional(Schema.Boolean),
      volume: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))),
      sound_pack: Schema.optional(Schema.String),
      sounds: Schema.optional(
        Schema.Record(
          Schema.Literals(["default", "question", "permission", "error", "done", "subagent_done"]),
          Schema.optionalKey(Schema.String),
        ),
      ),
    }),
  ),
  diffs: Schema.optional(
    Schema.Struct({
      wrap: Schema.optional(Schema.Literals(["word", "none"])),
      tree: Schema.optional(Schema.Boolean),
      single: Schema.optional(Schema.Boolean),
      view: Schema.optional(Schema.Literals(["auto", "split", "unified"])),
    }),
  ),
  terminal: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.Boolean),
    }),
  ),
  composer: Schema.optional(
    Schema.Struct({
      file_context: Schema.optional(Schema.Boolean),
      paste_summary: Schema.optional(Schema.Boolean),
    }),
  ),
  session: Schema.optional(
    Schema.Struct({
      sidebar: Schema.optional(Schema.Literals(["auto", "hide"])),
      scrollbar: Schema.optional(Schema.Boolean),
      thinking: Schema.optional(Schema.Literals(["show", "hide"])),
      group_exploration: Schema.optional(Schema.Boolean),
      directory_filter: Schema.optional(Schema.Boolean),
    }),
  ),
  which_key: Schema.optional(
    Schema.Struct({
      layout: Schema.optional(Schema.Literals(["dock", "overlay"])),
      pending_preview: Schema.optional(Schema.Boolean),
    }),
  ),
  hints: Schema.optional(
    Schema.Struct({
      tips: Schema.optional(Schema.Boolean),
      getting_started: Schema.optional(Schema.Boolean),
    }),
  ),
  updates: Schema.optional(
    Schema.Struct({
      skipped: Schema.optional(Schema.String),
    }),
  ),
  animations: Schema.optional(Schema.Boolean),
  mouse: Schema.optional(Schema.Boolean),
})
export type Info = Schema.Schema.Type<typeof Info>

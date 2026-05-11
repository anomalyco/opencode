import { ConfigPlugin } from "@/config/plugin"
import { Schema } from "effect"
import { TuiKeybind } from "./keybind"

const KeymapLeaderTimeout = Schema.Int.check(Schema.isGreaterThan(0)).annotate({
  description: "Leader key timeout in milliseconds",
})

const KeyStroke = Schema.Struct({
  name: Schema.String,
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
  super: Schema.optional(Schema.Boolean),
  hyper: Schema.optional(Schema.Boolean),
})

const BindingObject = Schema.StructWithRest(
  Schema.Struct({
    key: Schema.Union([Schema.String, KeyStroke]),
    event: Schema.optional(Schema.Literals(["press", "release"])),
    preventDefault: Schema.optional(Schema.Boolean),
    fallthrough: Schema.optional(Schema.Boolean),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const BindingItem = Schema.Union([Schema.String, KeyStroke, BindingObject])
const BindingValue = Schema.Union([
  Schema.Literal(false),
  Schema.Literal("none"),
  BindingItem,
  Schema.Array(BindingItem),
])

const KeybindOverrides = Schema.Struct(
  Object.fromEntries(
    Object.entries(TuiKeybind.Definitions).map(([name, item]) => [
      name,
      Schema.optional(BindingValue).annotate({ description: item.description }),
    ]),
  ),
).annotate({ description: "TUI keybinding overrides" })

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.String),
  keybinds: Schema.optional(KeybindOverrides),
  plugin: Schema.optional(Schema.Array(ConfigPlugin.Spec)),
  plugin_enabled: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  leader_timeout: Schema.optional(KeymapLeaderTimeout),
  scroll_speed: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.001))).annotate({
    description: "TUI scroll speed",
  }),
  scroll_acceleration: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean.annotate({ description: "Enable scroll acceleration" }),
    }),
  ).annotate({ description: "Scroll acceleration settings" }),
  diff_style: Schema.optional(Schema.Literals(["auto", "stacked"])).annotate({
    description: "Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column",
  }),
  mouse: Schema.optional(Schema.Boolean).annotate({ description: "Enable or disable mouse capture (default: true)" }),
})

export * as TuiJsonSchema from "./tui-json-schema"

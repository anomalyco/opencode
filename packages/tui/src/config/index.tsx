export * as TuiConfig from "."

import { createBindingLookup } from "@opentui/keymap/extras"
import { Schema } from "effect"
import { createContext, type JSX, useContext } from "solid-js"
import { TuiKeybind } from "./keybind"

export const AttentionSoundName = Schema.Literals([
  "default",
  "question",
  "permission",
  "error",
  "done",
  "subagent_done",
])
export type AttentionSoundName = Schema.Schema.Type<typeof AttentionSoundName>

export const PluginOptions = Schema.Record(Schema.String, Schema.Unknown)
export const PluginSpec = Schema.Union([Schema.String, Schema.mutable(Schema.Tuple([Schema.String, PluginOptions]))])

export const LeaderTimeoutDefault = 2000
export const LeaderTimeout = Schema.Int.check(Schema.isGreaterThan(0)).annotate({
  description: "Leader key timeout in milliseconds",
})

export const ScrollSpeed = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.001))
export const ScrollAcceleration = Schema.Struct({
  enabled: Schema.Boolean.annotate({ description: "Enable scroll acceleration" }),
}).annotate({ description: "Scroll acceleration settings" })
export const DiffStyle = Schema.Literals(["auto", "stacked"]).annotate({
  description: "Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column",
})
export const ModelLabel = Schema.Literals(["name", "id"]).annotate({
  description:
    "How message footers and the prompt label a model: 'name' (default) shows its display name, 'id' shows providerID/modelID, e.g. anthropic/claude-sonnet-4-5",
})
export const Cursor = Schema.Struct({
  style: Schema.optional(Schema.Literals(["block", "underline", "line", "default"])).annotate({
    description: "Cursor shape. Use 'default' to preserve the terminal setting",
  }),
  blinking: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the cursor blinks. Has no effect when style is 'default'",
  }),
}).annotate({ description: "Terminal cursor settings" })
export const TurnTiming = Schema.Struct({
  time: Schema.optional(Schema.Boolean).annotate({
    description:
      "Show when each assistant turn finished: the time of day if today, the date and time otherwise (default: false)",
  }),
  duration: Schema.optional(Schema.Boolean).annotate({
    description:
      "Show how long each assistant turn took; the final turn also keeps the total since the prompt (default: false)",
  }),
}).annotate({
  description:
    "Legacy default per-turn timing in assistant message footers, used while footer.time and footer.duration are unset; toggle at runtime with /turn-times and /turn-durations",
})

export const TimestampType = Schema.Literals(["user", "assistant", "text", "reasoning", "tool", "error", "compaction"])
export type TimestampType = Schema.Schema.Type<typeof TimestampType>
const timestampTypeNames = TimestampType.literals.join("|")
export const Timestamps = Schema.Union([
  Schema.String.check(
    Schema.isPattern(new RegExp(`^\\s*(all|none|(${timestampTypeNames})(\\s*,\\s*(${timestampTypeNames}))*)\\s*$`)),
  ),
  Schema.Array(TimestampType),
]).annotate({
  description: [
    "Which session transcript entries show a timestamp: 'all', 'none', a comma-separated list such as 'user,tool',",
    'or an array such as ["user", "tool"].',
    "Types: 'user' - when a prompt was sent;",
    "'assistant' - when an assistant turn finished, in its footer;",
    "'text' - when an assistant text block finished, below it;",
    "'reasoning' - when a thinking block finished, before its duration;",
    "'tool' - when a tool call finished and how long it ran;",
    "'error' - when an assistant turn failed, in its error box;",
    "'compaction' - when compaction started, in its divider.",
    "Times from today show the time of day; older ones show the date, then the time.",
    "Unset (the default): only 'user' and 'assistant' can show times, through /timestamps, /turn-times and",
    "turn_timing.time, and those toggles persist.",
    "Set: this list decides every type on each start, overriding turn_timing.time,",
    "and /timestamps and /turn-times last until the TUI exits.",
    "Legacy: footer.time takes the same list and wins when set; 'tool' here also shows tool call durations.",
  ].join(" "),
})

// Undefined when tui.json does not set `timestamps`, so callers can keep their unset behavior.
export function timestampTypes(value: Info["timestamps"]): ReadonlySet<TimestampType> | undefined {
  if (value === undefined) return
  if (typeof value !== "string") return new Set(value)
  const names = value.split(",").map((name) => name.trim())
  if (names.includes("all")) return new Set(TimestampType.literals)
  return new Set(TimestampType.literals.filter((type) => names.includes(type)))
}

// One value shape for every footer element. The type names are the `timestamps` vocabulary;
// 'important' adds the landmarks that ctrl+shift+up/down stops on.
const footerSelectorNames = [...TimestampType.literals, "important"].join("|")
export const FooterSelector = Schema.Literals([...TimestampType.literals, "important"])
export const FooterValue = Schema.Union([
  Schema.Boolean,
  Schema.String.check(
    Schema.isPattern(
      new RegExp(`^\\s*(all|none|(${footerSelectorNames})(\\s*,\\s*(${footerSelectorNames}))*)\\s*$`),
    ),
  ),
  Schema.Array(FooterSelector),
])
export type FooterValue = Schema.Schema.Type<typeof FooterValue>

const footerValueHelp = [
  "true or 'all' - everywhere it applies; false or 'none' - nowhere;",
  "'important' - only on landmarks, the entries ctrl+shift+up/down stops on: prompts, each turn's final response,",
  "and question, todo and subagent tool calls;",
  "or a list of entry types, as a comma-separated string ('user,assistant') or an array, which may include 'important'.",
].join(" ")
const footerElement = (description: string) =>
  Schema.optional(FooterValue).annotate({ description: `${description} Value: ${footerValueHelp}` })

export const Footer = Schema.Struct({
  agent: footerElement("The agent that ran a turn, in assistant footers. Applies to: assistant. Default: all."),
  model: footerElement(
    "The model a turn ran on, in assistant footers; model_label picks its name or id. Applies to: assistant. Default: all.",
  ),
  variant: footerElement(
    "The variant a turn ran with, such as its reasoning effort ('high'), after the model; turns without a variant show nothing. Applies to: assistant. Default: none, or all with the legacy footer_variant: true.",
  ),
  time: footerElement(
    [
      "When an entry happened: the time of day if today, the date and time otherwise.",
      "Applies to: user (prompt sent), assistant (turn finished, in its footer), text (text block finished, below it),",
      "reasoning (thinking block finished), tool (every tool call, plugin and MCP tools included, when it finished),",
      "error (turn failed, in its error box),",
      "compaction (compaction started, in its divider).",
      "Default: the legacy timestamps list when set; otherwise prompts and turns follow /timestamps and /turn-times",
      "(turn_timing.time for turns) and the other types are hidden.",
    ].join(" "),
  ),
  duration: footerElement(
    [
      "How long an entry took. Applies to: assistant (the turn's own message), reasoning (the thinking block),",
      "tool (every tool call).",
      "Default: reasoning; turns follow /turn-durations (turn_timing.duration); tool calls when the legacy",
      "timestamps list includes 'tool'.",
    ].join(" "),
  ),
  total: footerElement(
    "Time from the prompt to the end of the turn. Applies to: assistant, and only on a turn's final message, so 'important' and 'assistant' select the same footers as 'all'. Default: all.",
  ),
  message_id: footerElement(
    "The message ID (msg_...), selectable for drag-to-copy, at the end of the footer. Applies to: user, assistant, tool (the message the call belongs to). Default: none.",
  ),
}).annotate({
  description: [
    "Which details message footers show. Every element takes the same value.",
    "Assistant footers always show on a turn's last message; time, duration and message_id also show them on",
    "the turn's earlier messages they select.",
    "An element set here decides on every start, and its runtime toggle (/timestamps, /turn-times,",
    "/turn-durations) lasts until the TUI exits; unset, those toggles persist.",
    "Selecting a type an element does not apply to has no effect.",
  ].join(" "),
})
export type Footer = Schema.Schema.Type<typeof Footer>

export type FooterElement = keyof Footer
export type FooterSelection = { important: boolean; types: ReadonlySet<TimestampType> }

const noFooterTypes: ReadonlySet<TimestampType> = new Set()
const allFooterTypes: ReadonlySet<TimestampType> = new Set(TimestampType.literals)

export function footerSelection(value: FooterValue): FooterSelection {
  if (value === true) return { important: false, types: allFooterTypes }
  if (value === false) return { important: false, types: noFooterTypes }
  const names: readonly string[] = typeof value === "string" ? value.split(",").map((name) => name.trim()) : value
  if (names.includes("all")) return { important: false, types: allFooterTypes }
  return {
    important: names.includes("important"),
    types: new Set(TimestampType.literals.filter((type) => names.includes(type))),
  }
}

// Whether a selection shows on any entry of `type`, which is what a runtime toggle reports.
export function footerSelects(selection: FooterSelection, type: TimestampType) {
  return selection.important || selection.types.has(type)
}

// Whether a selection shows on one entry; `landmark` is only asked when 'important' decides.
export function footerShows(selection: FooterSelection, type: TimestampType, landmark: () => boolean) {
  if (selection.types.has(type)) return true
  return selection.important && landmark()
}

// Whether the runtime toggles for an element are session-only because tui.json decides it.
export function footerConfigured(config: Pick<Info, "footer" | "timestamps">, element: FooterElement) {
  if (config.footer?.[element] !== undefined) return true
  return element === "time" && config.timestamps !== undefined
}

// What each footer element selects before runtime overrides. `footer` wins; unset elements keep
// the behavior of the legacy keys (timestamps, turn_timing, footer_variant) and of the persisted
// /timestamps, /turn-times and /turn-durations toggles passed in `saved`.
export function footerSelections(
  config: Pick<Info, "footer" | "timestamps" | "turn_timing" | "footer_variant">,
  saved: { timestamps?: boolean; turnTime?: boolean; turnDuration?: boolean },
): Record<FooterElement, FooterSelection> {
  const legacy = timestampTypes(config.timestamps)
  const pick = (types: (TimestampType | false)[]) => ({
    important: false,
    types: new Set(TimestampType.literals.filter((type) => types.includes(type))),
  })
  const element = (key: FooterElement, fallback: FooterSelection) => {
    const value = config.footer?.[key]
    return value === undefined ? fallback : footerSelection(value)
  }
  return {
    agent: element("agent", footerSelection(true)),
    model: element("model", footerSelection(true)),
    variant: element("variant", footerSelection(config.footer_variant ?? false)),
    time: element(
      "time",
      legacy
        ? { important: false, types: legacy }
        : pick([
            saved.timestamps === true && "user",
            (saved.turnTime ?? config.turn_timing?.time) === true && "assistant",
          ]),
    ),
    duration: element(
      "duration",
      pick([
        "reasoning",
        (saved.turnDuration ?? config.turn_timing?.duration) === true && "assistant",
        legacy?.has("tool") === true && "tool",
      ]),
    ),
    total: element("total", footerSelection(true)),
    message_id: element("message_id", footerSelection(false)),
  }
}

export const AttentionSounds = Schema.Record(AttentionSoundName, Schema.optionalKey(Schema.String))
export type AttentionSoundPaths = Schema.Schema.Type<typeof AttentionSounds>
export const Attention = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  notifications: Schema.optional(Schema.Boolean),
  sound: Schema.optional(Schema.Boolean),
  volume: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))),
  sound_pack: Schema.optional(Schema.String),
  sounds: Schema.optional(AttentionSounds),
}).annotate({ description: "Attention notification and sound settings" })

const PromptSize = Schema.Int.check(Schema.isGreaterThan(0))
export const Prompt = Schema.Struct({
  max_height: Schema.optional(PromptSize).annotate({ description: "Prompt textarea max height" }),
  max_width: Schema.optional(Schema.Union([PromptSize, Schema.Literal("auto")])).annotate({
    description: "Home prompt max width: a positive integer for a fixed cap, or 'auto' to scale with terminal width",
  }),
}).annotate({ description: "Prompt size settings" })

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.String),
  keybinds: Schema.optional(TuiKeybind.KeybindOverrides),
  plugin: Schema.optional(Schema.Array(PluginSpec)),
  plugin_enabled: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  leader_timeout: Schema.optional(LeaderTimeout),
  attention: Schema.optional(Attention),
  prompt: Schema.optional(Prompt),
  scroll_speed: Schema.optional(ScrollSpeed).annotate({ description: "TUI scroll speed" }),
  scroll_acceleration: Schema.optional(ScrollAcceleration),
  diff_style: Schema.optional(DiffStyle),
  turn_timing: Schema.optional(TurnTiming),
  model_label: Schema.optional(ModelLabel),
  timestamps: Schema.optional(Timestamps),
  footer_variant: Schema.optional(Schema.Boolean).annotate({
    description:
      "Legacy alias of footer.variant: true shows the variant a turn ran with, such as its reasoning effort ('high'), after the model in assistant message footers (default: false). footer.variant wins when set",
  }),
  footer: Schema.optional(Footer),
  cursor: Schema.optional(Cursor),
  mouse: Schema.optional(Schema.Boolean).annotate({ description: "Enable or disable mouse capture (default: true)" }),
})
export type Info = Schema.Schema.Type<typeof Info>

export type Resolved = Omit<Info, "attention" | "keybinds" | "leader_timeout" | "mouse" | "cursor"> & {
  attention: {
    enabled: boolean
    notifications: boolean
    sound: boolean
    volume: number
    sound_pack: string
    sounds: AttentionSoundPaths
  }
  keybinds: TuiKeybind.BindingLookupView
  leader_timeout: number
  mouse: boolean
  cursor?: {
    style: "block" | "underline" | "line" | "default"
    blinking: boolean
  }
}

export const ResolveOptions = Schema.Struct({
  terminalSuspend: Schema.Boolean,
})
export type ResolveOptions = Schema.Schema.Type<typeof ResolveOptions>

export function resolve(input: Info, options: ResolveOptions): Resolved {
  const keybinds: TuiKeybind.KeybindOverrides = { ...input.keybinds }
  if (!options.terminalSuspend) {
    keybinds.terminal_suspend = "none"
    if (keybinds.input_undo === undefined) {
      const inputUndo = TuiKeybind.defaultValue("input_undo")
      keybinds.input_undo = ["ctrl+z", ...(typeof inputUndo === "string" ? inputUndo.split(",") : [])]
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(",")
    }
  }

  return {
    ...input,
    attention: {
      enabled: input.attention?.enabled ?? false,
      notifications: input.attention?.notifications ?? true,
      sound: input.attention?.sound ?? true,
      volume: input.attention?.volume ?? 0.4,
      sound_pack: input.attention?.sound_pack ?? "opencode.default",
      sounds: input.attention?.sounds ?? {},
    },
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse(keybinds)), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: input.leader_timeout ?? LeaderTimeoutDefault,
    mouse: input.mouse ?? true,
    cursor: input.cursor
      ? {
          style: input.cursor.style ?? "block",
          blinking: input.cursor.blinking ?? true,
        }
      : undefined,
  }
}

const ConfigContext = createContext<Resolved>()

export function TuiConfigProvider(props: { config: Resolved; children: JSX.Element }) {
  return <ConfigContext.Provider value={props.config}>{props.children}</ConfigContext.Provider>
}

export function useTuiConfig() {
  const value = useContext(ConfigContext)
  if (!value) throw new Error("TuiConfigProvider is missing")
  return value
}

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
    "Legacy per-turn timing in assistant message footers, used while footer.time and footer.duration are unset. Set here, it decides on every start and /turn-times and /turn-durations last until the TUI exits; unset, those toggles are remembered",
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
    "turn_timing.time; turn_timing.time set decides turns on each start, and otherwise those toggles persist.",
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
    Schema.isPattern(new RegExp(`^\\s*(all|none|(${footerSelectorNames})(\\s*,\\s*(${footerSelectorNames}))*)\\s*$`)),
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
      "When an entry happened: the time of day if today, the date and time otherwise. A running tool call shows when it started.",
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
      "tool (every tool call: while it runs, a stopwatch in whole seconds; once finished, tenths of a second up to 11 minutes).",
      "Default: reasoning; turns follow /turn-durations (turn_timing.duration); tool calls when the legacy",
      "timestamps list includes 'tool'.",
    ].join(" "),
  ),
  total: footerElement(
    "Time from the prompt to the end of the turn. Applies to: assistant, and only on a turn's final message, so 'important' and 'assistant' select the same footers as 'all'. Default: all.",
  ),
  message_id: footerElement(
    "The message ID (msg_...), selectable for drag-to-copy, at the end of the footer. Applies to: user, assistant, tool. A tool call shows the ID of the message it belongs to only when that message's own footer does not show it, so each ID appears once. Default: none.",
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

// A tool call belongs to its assistant message, so its footer repeats the message ID only when the
// message's own footer does not show it: each ID appears once.
export function toolFooterShowsMessageID(shows: (type: "tool" | "assistant") => boolean) {
  return shows("tool") && !shows("assistant")
}

// Whether the runtime toggle for an element on one entry type lasts only until exit because tui.json
// decides it: `footer`, the legacy `timestamps` list for time, or legacy `turn_timing` for turns.
export function footerConfigured(
  config: Pick<Info, "footer" | "timestamps" | "turn_timing">,
  element: FooterElement,
  type: TimestampType,
) {
  if (config.footer?.[element] !== undefined) return true
  if (element === "time" && config.timestamps !== undefined) return true
  if (type !== "assistant") return false
  if (element === "time") return config.turn_timing?.time !== undefined
  return element === "duration" && config.turn_timing?.duration !== undefined
}

// What each footer element selects before runtime overrides. `footer` wins; unset elements keep
// the behavior of the legacy keys (timestamps, turn_timing, footer_variant), which in turn win over
// the persisted /timestamps, /turn-times and /turn-durations toggles passed in `saved`.
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
            (config.turn_timing?.time ?? saved.turnTime) === true && "assistant",
          ]),
    ),
    duration: element(
      "duration",
      pick([
        "reasoning",
        (config.turn_timing?.duration ?? saved.turnDuration) === true && "assistant",
        legacy?.has("tool") === true && "tool",
      ]),
    ),
    total: element("total", footerSelection(true)),
    message_id: element("message_id", footerSelection(false)),
  }
}

// Literal text is anything that is not a letter, or text in [brackets]. Letters outside the
// part's own tokens are rejected, so "HH:MM:SS" (month, not minute) fails instead of misprinting.
const formatLiteral = "\\[[^\\]]*\\]|[^A-Za-z\\[\\]]"
const formatPattern = (tokens: string) => new RegExp(`^(?:${tokens}|${formatLiteral})+$`)
export const DateTimeFormat = Schema.Struct({
  date: Schema.optional(Schema.String.check(Schema.isPattern(formatPattern("YYYY|YY|MM|M|DD|D")))).annotate({
    description:
      "Date pattern, shown before the time on entries from another day: YYYY year, YY two-digit year, MM month (01-12), M month (1-12), DD day (01-31), D day (1-31); other letters must be in [brackets]. Example: 'YYYY-MM-DD'. Unset: the locale's date, e.g. 10/7/2026",
  }),
  time: Schema.optional(Schema.String.check(Schema.isPattern(formatPattern("HH|H|hh|h|mm|m|ss|s|A|a")))).annotate({
    description:
      "Time pattern: HH hour 00-23, H 0-23, hh hour 01-12, h 1-12, mm minute (lowercase; MM is the month and is rejected here), m minute, ss second, s second, A AM/PM, a am/pm; other letters must be in [brackets]. Example: 'HH:mm:ss'. Unset: the locale's short time, e.g. 2:20 PM",
  }),
}).annotate({
  description:
    "How times and dates are written in message footers, entry timestamps, the compaction divider and the timeline and stash dialogs. Entries from today show only the time, and switch to the date and time at midnight",
})

export const ToolOutputGroup = Schema.Literals(["bash", "generic", "write", "edit", "apply_patch"])
export type ToolOutputGroup = Schema.Schema.Type<typeof ToolOutputGroup>
export const ToolOutputCollapseDefaults: Record<ToolOutputGroup, number | "never"> = {
  bash: 10,
  generic: 3,
  write: "never",
  edit: "never",
  apply_patch: "never",
}
const CollapseLimit = Schema.Union([Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), Schema.Literal("never")])
const HeadLines = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const ToolOutput = Schema.Struct({
  collapse: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        bash: Schema.optional(CollapseLimit).annotate({
          description:
            "Lines of a bash command's output shown before 'Click to expand': a number of lines, 0 to hide it until clicked, or 'never' to always show all of it (default: 10)",
        }),
        generic: Schema.optional(CollapseLimit).annotate({
          description:
            "Lines of output of plugin, MCP and other tools without their own view shown before 'Click to expand': a number of lines, 0 to hide it until clicked, or 'never' to always show all of it. Set, it also shows that output on every start, whatever 'Show/Hide generic tool output' remembered (default: 3)",
        }),
        write: Schema.optional(CollapseLimit).annotate({
          description:
            "Rendered rows of a written file shown before 'Click to expand': a number of rows, 0 to hide it until clicked, or 'never' to always show all of it (default: never)",
        }),
        edit: Schema.optional(CollapseLimit).annotate({
          description:
            "Rendered rows of an edited file's diff shown before 'Click to expand': a number of rows, 0 to hide it until clicked, or 'never' to always show all of it (default: never)",
        }),
        apply_patch: Schema.optional(CollapseLimit).annotate({
          description:
            "Rendered rows of each patched file's diff shown before 'Click to expand': a number of rows, 0 to hide it until clicked, or 'never' to always show all of it (default: never)",
        }),
      }),
      [Schema.Record(Schema.String, CollapseLimit)],
    ),
  ).annotate({
    description: [
      "How many lines of a tool block's output show before 'Click to expand', per group or tool name.",
      "Groups: 'bash' (default 10), 'generic' - plugin, MCP and other tools without their own view (default 3),",
      "'write', 'edit', 'apply_patch' (default 'never').",
      "A tool name, such as 'vibeterm_prompt_session', overrides its group.",
      "A number of lines; 0 hides the output entirely until clicked, whatever tail and head say; 'never' always shows all of it.",
      "Setting 'generic' or a plugin or MCP tool's name also shows that output on every start, collapsed to",
      "its limit, whatever 'Show/Hide generic tool output' last remembered; that command then lasts until the TUI exits.",
      "Long lines count too: the preview is capped at that many lines' worth of characters.",
    ].join(" "),
  }),
  tail: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        bash: Schema.optional(Schema.Boolean).annotate({
          description:
            "Collapsed bash output shows its last lines under '(N earlier lines)' instead of its first (default: false)",
        }),
        generic: Schema.optional(Schema.Boolean).annotate({
          description:
            "Collapsed output of plugin, MCP and other tools without their own view shows its last lines under '(N earlier lines)' instead of its first (default: false)",
        }),
      }),
      [Schema.Record(Schema.String, Schema.Boolean)],
    ),
  ).annotate({
    description:
      "Which collapsed tool output shows its last lines, under '(N earlier lines)', instead of its first, per group ('bash', 'generic') or tool name; a tool name overrides its group (default: false)",
  }),
  head: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        bash: Schema.optional(HeadLines).annotate({
          description:
            "With tail on, the first lines of collapsed bash output kept above '(N more lines)'; the last lines fill the rest of the collapse limit (default: 0)",
        }),
        generic: Schema.optional(HeadLines).annotate({
          description:
            "With tail on, the first lines of collapsed output of plugin, MCP and other tools without their own view kept above '(N more lines)' (default: 0)",
        }),
      }),
      [Schema.Record(Schema.String, HeadLines)],
    ),
  ).annotate({
    description: [
      "With tail on, how many first lines of collapsed tool output stay above a '(N more lines)' marker, per group",
      "('bash', 'generic') or tool name; a tool name overrides its group. The last lines fill the rest of the",
      "collapse limit, so collapse 5 with head 2 shows 2 first lines, the marker and 2 last lines. At most the",
      "collapse limit minus 2, so a last line always shows. No effect with tail off (default: 0)",
    ].join(" "),
  }),
}).annotate({ description: "Tool output in the session transcript" })
export type ToolOutput = Schema.Schema.Type<typeof ToolOutput>

// Whether a tool's collapsed output shows its last lines rather than its first.
export function toolOutputTail(config: ToolOutput | undefined, tool: string, group: "bash" | "generic") {
  return config?.tail?.[tool] ?? config?.tail?.[group] ?? false
}

// First lines a tail preview keeps above its `(N more lines)` marker.
export function toolOutputHead(config: ToolOutput | undefined, tool: string, group: "bash" | "generic") {
  return config?.head?.[tool] ?? config?.head?.[group] ?? 0
}

export const ToolInput = Schema.Struct({
  collapse: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        bash: Schema.optional(CollapseLimit).annotate({
          description:
            "Rendered rows of a bash command shown before 'Click to expand': a number of rows, 0 to hide the command until clicked, or 'never' to always show all of it (default: never)",
        }),
      }),
      [Schema.Record(Schema.String, CollapseLimit)],
    ),
  ).annotate({
    description: [
      "How many rendered rows of a tool call's input show before 'Click to expand', per group or tool name.",
      "Group: 'bash', the shell command (default 'never'). A tool name overrides its group.",
      "The command keeps its wrapping and is cut after that many rows; one click expands the command and",
      "its output together, while tool_output.collapse still decides the output's lines.",
    ].join(" "),
  }),
}).annotate({ description: "Tool input in the session transcript" })
export type ToolInput = Schema.Schema.Type<typeof ToolInput>

// Rendered rows of a tool's input shown while collapsed; undefined when it never collapses.
export function toolInputLimit(config: ToolInput | undefined, tool: string, group: "bash") {
  const value = config?.collapse?.[tool] ?? config?.collapse?.[group] ?? "never"
  return value === "never" ? undefined : value
}

// Whether a plugin or MCP tool's output shows. `tool_output.collapse` naming the tool or 'generic'
// decides on every start, showing it collapsed to its limit, and the "Show/Hide generic tool output"
// command (`toggled`) then lasts until exit; otherwise that command's remembered choice (`saved`).
export function genericToolOutputShown(input: {
  config: ToolOutput | undefined
  tool?: string
  saved: boolean
  toggled?: boolean
}) {
  if (input.toggled !== undefined) return input.toggled
  const collapse = input.config?.collapse
  if (collapse?.generic !== undefined) return true
  if (input.tool !== undefined && collapse?.[input.tool] !== undefined) return true
  return input.saved
}

// Lines of output a tool block shows while collapsed; undefined when it never collapses.
export function toolOutputLimit(config: ToolOutput | undefined, tool: string, group: ToolOutputGroup) {
  const value = config?.collapse?.[tool] ?? config?.collapse?.[group] ?? ToolOutputCollapseDefaults[group]
  return value === "never" ? undefined : value
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
  datetime_format: Schema.optional(DateTimeFormat),
  tool_output: Schema.optional(ToolOutput),
  tool_input: Schema.optional(ToolInput),
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

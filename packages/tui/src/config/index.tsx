export * as Config from "."

import { createBindingLookup } from "@opentui/keymap/extras"
import { Schema } from "effect"
import { createContext, type JSX, useContext } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { TuiKeybind } from "./keybind"

export interface Interface {
  readonly path?: string
  readonly get: () => Promise<Info>
  readonly update: (update: (draft: any) => void) => Promise<Info>
}

export const AttentionSoundName = Schema.Literals([
  "default",
  "question",
  "permission",
  "error",
  "done",
  "subagent_done",
])
export type AttentionSoundName = Schema.Schema.Type<typeof AttentionSoundName>
export type AttentionSoundPaths = Partial<Record<AttentionSoundName, string>>

export const Plugin = Schema.Union([
  Schema.String,
  Schema.Struct({
    package: Schema.String.annotate({ description: "Plugin package name or path" }),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)).annotate({
      description: "Options passed to the plugin",
    }),
  }),
])

export const Info = Schema.Struct({
  theme: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String).annotate({ description: "Theme name" }),
      mode: Schema.optional(Schema.Literals(["system", "dark", "light"])).annotate({
        description: "Color mode; 'system' follows the terminal",
      }),
    }),
  ).annotate({ description: "Color theme settings" }),
  keybinds: Schema.optional(TuiKeybind.KeybindOverrides).annotate({ description: "Custom key bindings" }),
  plugins: Schema.optional(Schema.Array(Plugin)).annotate({
    description: "Ordered plugin enablement directives and external package declarations",
  }),
  leader: Schema.optional(
    Schema.Struct({
      timeout: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
        description: "Time in milliseconds to wait for a key after the leader key",
      }),
    }),
  ).annotate({ description: "Leader key behavior" }),
  scroll: Schema.optional(
    Schema.Struct({
      speed: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.001))).annotate({
        description: "Distance scrolled per input tick",
      }),
      acceleration: Schema.optional(Schema.Boolean).annotate({
        description: "Accelerate scrolling from repeated input",
      }),
    }),
  ).annotate({ description: "Scrolling behavior" }),
  attention: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable attention alerts" }),
      notifications: Schema.optional(Schema.Boolean).annotate({ description: "Show system notifications" }),
      sound: Schema.optional(Schema.Boolean).annotate({ description: "Play attention sounds" }),
      volume: Schema.optional(
        Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
      ).annotate({ description: "Attention sound volume from 0 to 1" }),
      sound_pack: Schema.optional(Schema.String).annotate({ description: "Active attention sound pack ID" }),
      sounds: Schema.optional(Schema.Record(AttentionSoundName, Schema.optionalKey(Schema.String))).annotate({
        description: "Sound file overrides by attention event",
      }),
    }),
  ).annotate({ description: "System notification and sound settings" }),
  diffs: Schema.optional(
    Schema.Struct({
      wrap: Schema.optional(Schema.Literals(["word", "none"])).annotate({
        description: "Line wrapping behavior in diff output",
      }),
      tree: Schema.optional(Schema.Boolean).annotate({ description: "Show the diff file tree" }),
      single: Schema.optional(Schema.Boolean).annotate({ description: "Show only the selected file patch" }),
      view: Schema.optional(Schema.Literals(["auto", "split", "unified"])).annotate({
        description: "Diff layout; 'auto' selects a layout from the available width",
      }),
    }),
  ).annotate({ description: "Diff presentation settings" }),
  terminal: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.Boolean).annotate({ description: "Update the terminal window title" }),
    }),
  ).annotate({ description: "Terminal integration settings" }),
  prompt: Schema.optional(
    Schema.Struct({
      editor: Schema.optional(Schema.Boolean).annotate({
        description: "Include the active editor file or selection as prompt context",
      }),
      paste: Schema.optional(Schema.Literals(["compact", "full"])).annotate({
        description: "Display large pastes as compact placeholders or full text",
      }),
    }),
  ).annotate({ description: "Prompt input behavior" }),
  session: Schema.optional(
    Schema.Struct({
      sidebar: Schema.optional(Schema.Literals(["auto", "hide"])).annotate({
        description: "Session sidebar visibility; 'auto' shows it when space permits",
      }),
      scrollbar: Schema.optional(Schema.Boolean).annotate({ description: "Show the session transcript scrollbar" }),
      thinking: Schema.optional(Schema.Literals(["show", "hide"])).annotate({
        description: "Show or hide model reasoning by default",
      }),
      grouping: Schema.optional(Schema.Literals(["auto", "none"])).annotate({
        description: "Group related transcript items automatically or render each item separately",
      }),
      markdown: Schema.optional(Schema.Literals(["source", "rendered"])).annotate({
        description: "Show Markdown syntax markers or conceal them in rendered transcript content",
      }),
    }),
  ).annotate({ description: "Session transcript presentation settings" }),
  hints: Schema.optional(
    Schema.Struct({
      onboarding: Schema.optional(Schema.Boolean).annotate({ description: "Show getting-started guidance" }),
    }),
  ).annotate({ description: "In-product guidance settings" }),
  debug: Schema.optional(
    Schema.Struct({
      devtools: Schema.optional(Schema.Boolean).annotate({ description: "Show the DevTools sidebar" }),
    }),
  ).annotate({ description: "Debugging settings" }),
  animations: Schema.optional(Schema.Boolean).annotate({ description: "Enable interface animations" }),
  mouse: Schema.optional(Schema.Boolean).annotate({ description: "Enable terminal mouse capture" }),
})
export type Info = Schema.Schema.Type<typeof Info>

export type Resolved = Omit<Info, "attention" | "keybinds" | "leader" | "mouse"> & {
  attention: {
    enabled: boolean
    notifications: boolean
    sound: boolean
    volume: number
    sound_pack: string
    sounds: AttentionSoundPaths
  }
  keybinds: TuiKeybind.BindingLookupView
  leader: { timeout: number }
  mouse: boolean
}

export function resolve(input: Info, options: { terminalSuspend: boolean }): Resolved {
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
    leader: { timeout: input.leader?.timeout ?? 2000 },
    mouse: input.mouse ?? true,
  }
}

const ConfigContext = createContext<{
  data: Resolved
  path?: string
  update: Interface["update"]
}>()

export function ConfigProvider(props: {
  config: Resolved
  service?: Interface
  options?: { terminalSuspend: boolean }
  children: JSX.Element
}) {
  const [config, setConfig] = createStore(props.config)
  const host = props.service
  const update = async (update: (draft: any) => void) => {
    if (!host) throw new Error("Config updates are not available")
    const info = await host.update(update)
    setConfig(reconcile(resolve(info, props.options ?? { terminalSuspend: true })))
    return info
  }
  return (
    <ConfigContext.Provider value={{ data: config, path: host?.path, update }}>{props.children}</ConfigContext.Provider>
  )
}

export function useConfig() {
  const value = useContext(ConfigContext)
  if (!value) throw new Error("ConfigProvider is missing")
  return value
}

export function useConfigOptional() {
  return useContext(ConfigContext)
}

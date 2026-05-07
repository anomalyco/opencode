import z from "zod"
import type { KeyEvent, Renderable } from "@opentui/core"
import type { Binding } from "@opentui/keymap"
import type { ResolvedBindingSections } from "@opentui/keymap/extras"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"

const KeybindOverride = z
  .object(
    Object.fromEntries(Object.keys(ConfigKeybinds.Keybinds.shape).map((key) => [key, z.string().optional()])) as Record<
      string,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict()

const KeyStroke = z
  .object({
    name: z.string(),
    ctrl: z.boolean().optional(),
    shift: z.boolean().optional(),
    meta: z.boolean().optional(),
    super: z.boolean().optional(),
    hyper: z.boolean().optional(),
  })
  .strict()

const KeymapBindingObject = z
  .object({
    key: z.union([z.string(), KeyStroke]),
    event: z.enum(["press", "release"]).optional(),
    preventDefault: z.boolean().optional(),
    fallthrough: z.boolean().optional(),
  })
  .passthrough()

const KeymapBindingItem = z.union([z.string(), KeyStroke, KeymapBindingObject])
const KeymapBindingValue = z.union([z.literal(false), z.literal("none"), KeymapBindingItem, z.array(KeymapBindingItem)])

const keymapBinding = (value: z.input<typeof KeymapBindingValue> | (() => z.input<typeof KeymapBindingValue>)) =>
  KeymapBindingValue.prefault(value)
const keymapSection = <Shape extends z.ZodRawShape>(shape: Shape) => {
  const schema = z.object(shape).strict()
  return schema.prefault({} as z.input<typeof schema>)
}
const keymapSectionInput = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z
    .object(
      Object.fromEntries(Object.keys(shape).map((key) => [key, KeymapBindingValue.optional()])) as {
        [Key in keyof Shape]: z.ZodOptional<typeof KeymapBindingValue>
      },
    )
    .strict()

const GlobalKeymapSection = {
  "command.palette.show": keymapBinding("ctrl+p"),
  "session.list": keymapBinding("<leader>l"),
  "session.new": keymapBinding("<leader>n"),
  "model.list": keymapBinding("<leader>m"),
  "model.cycle_recent": keymapBinding("f2"),
  "model.cycle_recent_reverse": keymapBinding("shift+f2"),
  "model.cycle_favorite": keymapBinding("none"),
  "model.cycle_favorite_reverse": keymapBinding("none"),
  "agent.list": keymapBinding("<leader>a"),
  "mcp.list": keymapBinding("none"),
  "agent.cycle": keymapBinding("tab"),
  "agent.cycle.reverse": keymapBinding("shift+tab"),
  "variant.cycle": keymapBinding("ctrl+t"),
  "variant.list": keymapBinding("none"),
  "provider.connect": keymapBinding("none"),
  "console.org.switch": keymapBinding("none"),
  "opencode.status": keymapBinding("<leader>s"),
  "theme.switch": keymapBinding("<leader>t"),
  "theme.switch_mode": keymapBinding("none"),
  "theme.mode.lock": keymapBinding("none"),
  "help.show": keymapBinding("none"),
  "docs.open": keymapBinding("none"),
  "app.exit": keymapBinding("ctrl+c,ctrl+d,<leader>q"),
  "app.debug": keymapBinding("none"),
  "app.console": keymapBinding("none"),
  "app.heap_snapshot": keymapBinding("none"),
  "app.toggle.animations": keymapBinding("none"),
  "app.toggle.file_context": keymapBinding("none"),
  "app.toggle.diffwrap": keymapBinding("none"),
  "app.toggle.paste_summary": keymapBinding("none"),
  "app.toggle.session_directory_filter": keymapBinding("none"),
  "terminal.suspend": keymapBinding(() => (process.platform === "win32" ? "none" : "ctrl+z")),
  "terminal.title.toggle": keymapBinding("none"),
}

const SessionKeymapSection = {
  "session.share": keymapBinding("none"),
  "session.rename": keymapBinding("ctrl+r"),
  "session.timeline": keymapBinding("<leader>g"),
  "session.fork": keymapBinding("none"),
  "session.compact": keymapBinding("<leader>c"),
  "session.unshare": keymapBinding("none"),
  "session.undo": keymapBinding("<leader>u"),
  "session.redo": keymapBinding("<leader>r"),
  "session.sidebar.toggle": keymapBinding("<leader>b"),
  "session.toggle.conceal": keymapBinding("<leader>h"),
  "session.toggle.timestamps": keymapBinding("none"),
  "session.toggle.thinking": keymapBinding("none"),
  "session.toggle.actions": keymapBinding("none"),
  "session.toggle.scrollbar": keymapBinding("none"),
  "session.toggle.generic_tool_output": keymapBinding("none"),
  "session.page.up": keymapBinding("pageup,ctrl+alt+b"),
  "session.page.down": keymapBinding("pagedown,ctrl+alt+f"),
  "session.line.up": keymapBinding("ctrl+alt+y"),
  "session.line.down": keymapBinding("ctrl+alt+e"),
  "session.half.page.up": keymapBinding("ctrl+alt+u"),
  "session.half.page.down": keymapBinding("ctrl+alt+d"),
  "session.first": keymapBinding("ctrl+g,home"),
  "session.last": keymapBinding("ctrl+alt+g,end"),
  "session.messages_last_user": keymapBinding("none"),
  "session.message.next": keymapBinding("none"),
  "session.message.previous": keymapBinding("none"),
  "messages.copy": keymapBinding("<leader>y"),
  "session.copy": keymapBinding("none"),
  "session.export": keymapBinding("<leader>x"),
  "session.child.first": keymapBinding("<leader>down"),
  "session.parent": keymapBinding("up"),
  "session.child.next": keymapBinding("right"),
  "session.child.previous": keymapBinding("left"),
}

const PromptKeymapSection = {
  "prompt.submit": keymapBinding("none"),
  "prompt.editor": keymapBinding("<leader>e"),
  "prompt.editor_context.clear": keymapBinding("none"),
  "prompt.skills": keymapBinding("none"),
  "prompt.stash": keymapBinding("none"),
  "prompt.stash.pop": keymapBinding("none"),
  "prompt.stash.list": keymapBinding("none"),
  "workspace.set": keymapBinding("none"),
  "session.interrupt": keymapBinding("escape"),
  "prompt.clear": keymapBinding("ctrl+c"),
  "prompt.paste": keymapBinding({ key: "ctrl+v", preventDefault: false }),
  "prompt.history.previous": keymapBinding("up"),
  "prompt.history.next": keymapBinding("down"),
}

const AutocompleteKeymapSection = {
  "prompt.autocomplete.prev": keymapBinding("up,ctrl+p"),
  "prompt.autocomplete.next": keymapBinding("down,ctrl+n"),
  "prompt.autocomplete.hide": keymapBinding("escape"),
  "prompt.autocomplete.select": keymapBinding("return"),
  "prompt.autocomplete.complete": keymapBinding("tab"),
}

const InputKeymapSection = {
  "input.submit": keymapBinding("return"),
  "input.newline": keymapBinding("shift+return,ctrl+return,alt+return,ctrl+j"),
  "input.move.left": keymapBinding("left,ctrl+b"),
  "input.move.right": keymapBinding("right,ctrl+f"),
  "input.move.up": keymapBinding("up"),
  "input.move.down": keymapBinding("down"),
  "input.select.left": keymapBinding("shift+left"),
  "input.select.right": keymapBinding("shift+right"),
  "input.select.up": keymapBinding("shift+up"),
  "input.select.down": keymapBinding("shift+down"),
  "input.line.home": keymapBinding("ctrl+a"),
  "input.line.end": keymapBinding("ctrl+e"),
  "input.select.line.home": keymapBinding("ctrl+shift+a"),
  "input.select.line.end": keymapBinding("ctrl+shift+e"),
  "input.visual.line.home": keymapBinding("alt+a"),
  "input.visual.line.end": keymapBinding("alt+e"),
  "input.select.visual.line.home": keymapBinding("alt+shift+a"),
  "input.select.visual.line.end": keymapBinding("alt+shift+e"),
  "input.buffer.home": keymapBinding("home"),
  "input.buffer.end": keymapBinding("end"),
  "input.select.buffer.home": keymapBinding("shift+home"),
  "input.select.buffer.end": keymapBinding("shift+end"),
  "input.delete.line": keymapBinding("ctrl+shift+d"),
  "input.delete.to.line.end": keymapBinding("ctrl+k"),
  "input.delete.to.line.start": keymapBinding("ctrl+u"),
  "input.backspace": keymapBinding("backspace,shift+backspace"),
  "input.delete": keymapBinding("ctrl+d,delete,shift+delete"),
  "input.undo": keymapBinding(() => (process.platform === "win32" ? "ctrl+z,ctrl+-,super+z" : "ctrl+-,super+z")),
  "input.redo": keymapBinding("ctrl+.,super+shift+z"),
  "input.word.forward": keymapBinding("alt+f,alt+right,ctrl+right"),
  "input.word.backward": keymapBinding("alt+b,alt+left,ctrl+left"),
  "input.select.word.forward": keymapBinding("alt+shift+f,alt+shift+right"),
  "input.select.word.backward": keymapBinding("alt+shift+b,alt+shift+left"),
  "input.delete.word.forward": keymapBinding("alt+d,alt+delete,ctrl+delete"),
  "input.delete.word.backward": keymapBinding("ctrl+w,ctrl+backspace,alt+backspace"),
  "input.select.all": keymapBinding("super+a"),
}

const DialogSelectKeymapSection = {
  "dialog.select.prev": keymapBinding("up,ctrl+p"),
  "dialog.select.next": keymapBinding("down,ctrl+n"),
  "dialog.select.page_up": keymapBinding("pageup"),
  "dialog.select.page_down": keymapBinding("pagedown"),
  "dialog.select.home": keymapBinding("home"),
  "dialog.select.end": keymapBinding("end"),
  "dialog.select.submit": keymapBinding("return"),
}

const DialogActionsKeymapSection = {
  "dialog.action.toggle": keymapBinding("space"),
  "dialog.action.delete": keymapBinding("ctrl+d"),
  "dialog.action.rename": keymapBinding("ctrl+r"),
}

const ModelKeymapSection = {
  "model.dialog.provider": keymapBinding("ctrl+a"),
  "model.dialog.favorite": keymapBinding("ctrl+f"),
}

const PermissionKeymapSection = {
  "permission.reject.cancel": keymapBinding("ctrl+c,ctrl+d,<leader>q"),
  "permission.prompt.escape": keymapBinding("ctrl+c,ctrl+d,<leader>q"),
  "permission.prompt.fullscreen": keymapBinding("ctrl+f"),
}

const QuestionKeymapSection = {
  "question.reject": keymapBinding("ctrl+c,ctrl+d,<leader>q"),
  "question.edit.clear": keymapBinding("ctrl+c"),
}

const PluginsKeymapSection = {
  "plugins.list": keymapBinding("none"),
  "plugins.install": keymapBinding("none"),
  "plugin.dialog.install": keymapBinding("shift+i"),
}

const HomeTipsKeymapSection = {
  "tips.toggle": keymapBinding("<leader>h"),
}

const KeymapSectionsShape = {
  global: keymapSection(GlobalKeymapSection),
  session: keymapSection(SessionKeymapSection),
  prompt: keymapSection(PromptKeymapSection),
  autocomplete: keymapSection(AutocompleteKeymapSection),
  input: keymapSection(InputKeymapSection),
  dialog_select: keymapSection(DialogSelectKeymapSection),
  dialog_actions: keymapSection(DialogActionsKeymapSection),
  model: keymapSection(ModelKeymapSection),
  permission: keymapSection(PermissionKeymapSection),
  question: keymapSection(QuestionKeymapSection),
  plugins: keymapSection(PluginsKeymapSection),
  home_tips: keymapSection(HomeTipsKeymapSection),
}

const KeymapSectionsInputShape = {
  global: keymapSectionInput(GlobalKeymapSection).optional(),
  session: keymapSectionInput(SessionKeymapSection).optional(),
  prompt: keymapSectionInput(PromptKeymapSection).optional(),
  autocomplete: keymapSectionInput(AutocompleteKeymapSection).optional(),
  input: keymapSectionInput(InputKeymapSection).optional(),
  dialog_select: keymapSectionInput(DialogSelectKeymapSection).optional(),
  dialog_actions: keymapSectionInput(DialogActionsKeymapSection).optional(),
  model: keymapSectionInput(ModelKeymapSection).optional(),
  permission: keymapSectionInput(PermissionKeymapSection).optional(),
  question: keymapSectionInput(QuestionKeymapSection).optional(),
  plugins: keymapSectionInput(PluginsKeymapSection).optional(),
  home_tips: keymapSectionInput(HomeTipsKeymapSection).optional(),
}

export const KeymapSections = z.object(KeymapSectionsShape).strict().prefault({})
export type KeymapSections = z.output<typeof KeymapSections>
export type KeymapSection = keyof KeymapSections
export const KeymapSectionNames = Object.keys(KeymapSectionsShape) as KeymapSection[]
export const KeymapLeaderTimeoutDefault = 2000
export type KeymapInfo = {
  leader: string
  leader_timeout: number
} & ResolvedBindingSections<Renderable, KeyEvent, KeymapSection>

export const KeymapSectionGroups = {
  global: "Global",
  session: "Session",
  prompt: "Prompt",
  autocomplete: "Autocomplete",
  input: "Text Editing",
  dialog_select: "Dialog",
  dialog_actions: "Dialog",
  model: "Model",
  permission: "Permission",
  question: "Question",
  plugins: "Plugins",
  home_tips: "Home",
} satisfies Record<KeymapSection, string>

export function keymapBindingDefaults(input: { section: string; binding: Readonly<Binding<Renderable, KeyEvent>> }) {
  if (input.binding.group !== undefined) return
  if (!Object.hasOwn(KeymapSectionGroups, input.section)) return
  return { group: KeymapSectionGroups[input.section as KeymapSection] }
}

export const KeymapConfig = z
  .object({
    leader: z.string().prefault("ctrl+x"),
    leader_timeout: z
      .number()
      .int()
      .positive()
      .prefault(KeymapLeaderTimeoutDefault)
      .describe("Leader key timeout in milliseconds"),
    sections: KeymapSections,
  })
  .strict()
  .describe("TUI keymap configuration")
export type KeymapConfig = z.output<typeof KeymapConfig>

const KeymapSectionsInput = z.object(KeymapSectionsInputShape).strict().optional()
export const KeymapConfigInput = z
  .object({
    leader: z.string().optional(),
    leader_timeout: z.number().int().positive().optional().describe("Leader key timeout in milliseconds"),
    sections: KeymapSectionsInput,
  })
  .strict()
  .describe("TUI keymap configuration")
export type KeymapConfigInput = z.output<typeof KeymapConfigInput>

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  mouse: z.boolean().optional().describe("Enable or disable mouse capture (default: true)"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional().meta({
      deprecated: true,
      description: "Use keymap instead. This will be removed in opencode v2.0.",
    }),
    keymap: KeymapConfigInput.optional(),
    plugin: ConfigPlugin.Spec.zod.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
  })
  .extend(TuiOptions.shape)
  .strict()

export const TuiJsonSchemaInfo = TuiInfo.extend({
  keymap: KeymapConfig.optional(),
}).strict()

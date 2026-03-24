import type {
  OpencodeClient,
  Event,
  LspStatus,
  McpStatus,
  Todo,
  Message,
  Provider,
  Config as SdkConfig,
} from "@opencode-ai/sdk/v2"
import type { CliRenderer, ParsedKey, RGBA } from "@opentui/core"
import type { JSX, SolidPlugin } from "@opentui/solid"
import type { Config as PluginConfig, Plugin, PluginOptions } from "./index.js"

export type { CliRenderer, SlotMode } from "@opentui/core"

export type TuiRouteCurrent =
  | {
      name: "home"
    }
  | {
      name: "session"
      params: {
        sessionID: string
        initialPrompt?: unknown
      }
    }
  | {
      name: string
      params?: Record<string, unknown>
    }

export type TuiRouteDefinition = {
  name: string
  render: (input: { params?: Record<string, unknown> }) => JSX.Element
}

export type TuiCommand = {
  title: string
  value: string
  description?: string
  category?: string
  keybind?: string
  suggested?: boolean
  hidden?: boolean
  enabled?: boolean
  slash?: {
    name: string
    aliases?: string[]
  }
  onSelect?: () => void
}

export type TuiKeybind = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
  leader: boolean
}

export type TuiKeybindMap = Record<string, string>

export type TuiKeybindSet = {
  readonly all: TuiKeybindMap
  get: (name: string) => string
  match: (name: string, evt: ParsedKey) => boolean
  print: (name: string) => string
}

export type TuiDialogProps = {
  size?: "medium" | "large"
  onClose: () => void
  children?: JSX.Element
}

export type TuiDialogStack = {
  replace: (render: () => JSX.Element, onClose?: () => void) => void
  clear: () => void
  setSize: (size: "medium" | "large") => void
  readonly size: "medium" | "large"
  readonly depth: number
  readonly open: boolean
}

export type TuiDialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export type TuiDialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
}

export type TuiDialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export type TuiDialogSelectOption<Value = unknown> = {
  title: string
  value: Value
  description?: string
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  onSelect?: () => void
}

export type TuiDialogSelectProps<Value = unknown> = {
  title: string
  placeholder?: string
  options: TuiDialogSelectOption<Value>[]
  flat?: boolean
  onMove?: (option: TuiDialogSelectOption<Value>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: TuiDialogSelectOption<Value>) => void
  skipFilter?: boolean
  current?: Value
}

export type TuiToast = {
  variant?: "info" | "success" | "warning" | "error"
  title?: string
  message: string
  duration?: number
}

export type TuiThemeCurrent = {
  readonly primary: RGBA
  readonly secondary: RGBA
  readonly accent: RGBA
  readonly error: RGBA
  readonly warning: RGBA
  readonly success: RGBA
  readonly info: RGBA
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly selectedListItemText: RGBA
  readonly background: RGBA
  readonly backgroundPanel: RGBA
  readonly backgroundElement: RGBA
  readonly backgroundMenu: RGBA
  readonly border: RGBA
  readonly borderActive: RGBA
  readonly borderSubtle: RGBA
  readonly diffAdded: RGBA
  readonly diffRemoved: RGBA
  readonly diffContext: RGBA
  readonly diffHunkHeader: RGBA
  readonly diffHighlightAdded: RGBA
  readonly diffHighlightRemoved: RGBA
  readonly diffAddedBg: RGBA
  readonly diffRemovedBg: RGBA
  readonly diffContextBg: RGBA
  readonly diffLineNumber: RGBA
  readonly diffAddedLineNumberBg: RGBA
  readonly diffRemovedLineNumberBg: RGBA
  readonly markdownText: RGBA
  readonly markdownHeading: RGBA
  readonly markdownLink: RGBA
  readonly markdownLinkText: RGBA
  readonly markdownCode: RGBA
  readonly markdownBlockQuote: RGBA
  readonly markdownEmph: RGBA
  readonly markdownStrong: RGBA
  readonly markdownHorizontalRule: RGBA
  readonly markdownListItem: RGBA
  readonly markdownListEnumeration: RGBA
  readonly markdownImage: RGBA
  readonly markdownImageText: RGBA
  readonly markdownCodeBlock: RGBA
  readonly syntaxComment: RGBA
  readonly syntaxKeyword: RGBA
  readonly syntaxFunction: RGBA
  readonly syntaxVariable: RGBA
  readonly syntaxString: RGBA
  readonly syntaxNumber: RGBA
  readonly syntaxType: RGBA
  readonly syntaxOperator: RGBA
  readonly syntaxPunctuation: RGBA
  readonly thinkingOpacity: number
}

export type TuiTheme = {
  readonly current: TuiThemeCurrent
  readonly selected: string
  has: (name: string) => boolean
  set: (name: string) => boolean
  install: (jsonPath: string) => Promise<void>
  mode: () => "dark" | "light"
  readonly ready: boolean
}

export type TuiKV = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
  readonly ready: boolean
}

export type TuiState = {
  readonly ready: boolean
  readonly config: SdkConfig
  readonly provider: ReadonlyArray<Provider>
  session: {
    diff: (sessionID: string) => ReadonlyArray<TuiSidebarFileItem>
    todo: (sessionID: string) => ReadonlyArray<TuiSidebarTodoItem>
    messages: (sessionID: string) => ReadonlyArray<Message>
  }
  lsp: () => ReadonlyArray<TuiSidebarLspItem>
  mcp: () => ReadonlyArray<TuiSidebarMcpItem>
}

type TuiConfigView = Pick<PluginConfig, "$schema" | "theme" | "keybinds" | "plugin"> & NonNullable<PluginConfig["tui"]>

export type TuiApp = {
  readonly version: string
  readonly directory: string
}

type Frozen<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Frozen<Item>>
    : Value extends object
      ? { readonly [Key in keyof Value]: Frozen<Value[Key]> }
      : Value

export type TuiApi = {
  app: TuiApp
  command: {
    register: (cb: () => TuiCommand[]) => () => void
    trigger: (value: string) => void
  }
  route: {
    register: (routes: TuiRouteDefinition[]) => () => void
    navigate: (name: string, params?: Record<string, unknown>) => void
    readonly current: TuiRouteCurrent
  }
  ui: {
    Dialog: (props: TuiDialogProps) => JSX.Element
    DialogAlert: (props: TuiDialogAlertProps) => JSX.Element
    DialogConfirm: (props: TuiDialogConfirmProps) => JSX.Element
    DialogPrompt: (props: TuiDialogPromptProps) => JSX.Element
    DialogSelect: <Value = unknown>(props: TuiDialogSelectProps<Value>) => JSX.Element
    toast: (input: TuiToast) => void
    dialog: TuiDialogStack
  }
  keybind: {
    match: (key: string, evt: ParsedKey) => boolean
    print: (key: string) => string
    create: (defaults: TuiKeybindMap, overrides?: Record<string, unknown>) => TuiKeybindSet
  }
  readonly tuiConfig: Frozen<TuiConfigView>
  kv: TuiKV
  state: TuiState
  theme: TuiTheme
}

export type TuiSidebarMcpItem = {
  name: string
  status: McpStatus["status"]
  error?: string
}

export type TuiSidebarLspItem = Pick<LspStatus, "id" | "root" | "status">

export type TuiSidebarTodoItem = Pick<Todo, "content" | "status">

export type TuiSidebarFileItem = {
  file: string
  additions: number
  deletions: number
}

export type TuiSlotMap = {
  app: {}
  home_logo: {}
  home_tips: {
    show_tips: boolean
    tips_hidden: boolean
    first_time_user: boolean
  }
  home_below_tips: {
    show_tips: boolean
    tips_hidden: boolean
    first_time_user: boolean
  }
  sidebar_title: {
    session_id: string
    title: string
    share_url?: string
  }
  sidebar_content: {
    session_id: string
  }
  sidebar_footer: {
    session_id: string
  }
}

export type TuiSlotContext = {
  theme: TuiTheme
}

type SlotCore = SolidPlugin<TuiSlotMap, TuiSlotContext>

export type TuiSlotPlugin = Omit<SlotCore, "id"> & {
  id?: never
}

export type TuiSlots = {
  register: (plugin: TuiSlotPlugin) => string
}

export type TuiEventBus = {
  on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => () => void
}

export type TuiDispose = () => void | Promise<void>

export type TuiLifecycle = {
  readonly signal: AbortSignal
  onDispose: (fn: TuiDispose) => () => void
}

export type TuiPluginState = "first" | "updated" | "same"

export type TuiPluginEntry = {
  name: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  requested?: string
  version?: string
  modified?: number
  first_time: number
  last_time: number
  time_changed: number
  load_count: number
  fingerprint: string
}

export type TuiPluginMeta = TuiPluginEntry & {
  state: TuiPluginState
}

export type TuiHostPluginApi<Renderer = CliRenderer> = TuiApi & {
  client: OpencodeClient
  event: TuiEventBus
  renderer: Renderer
}

export type TuiPluginApi<Renderer = CliRenderer> = TuiHostPluginApi<Renderer> & {
  slots: TuiSlots
  lifecycle: TuiLifecycle
}

export type TuiPlugin<Renderer = CliRenderer> = (
  api: TuiPluginApi<Renderer>,
  options: PluginOptions | undefined,
  meta: TuiPluginMeta,
) => Promise<void>

export type TuiPluginModule<Renderer = CliRenderer> = {
  server?: Plugin
  tui?: TuiPlugin<Renderer>
}

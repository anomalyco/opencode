import type {
  AgentInfo,
  CommandInfo,
  FormInfo,
  IntegrationInfo,
  LocationRef,
  McpResource,
  McpServer,
  ModelInfo,
  OpenCodeClient,
  OpenCodeEvent,
  PermissionSavedInfo,
  PermissionRequest,
  ProviderInfo,
  ReferenceInfo,
  SessionInfo,
  SessionMessageInfo,
  SessionPendingInfo,
  ShellInfo,
  SkillInfo,
} from "@opencode-ai/client"
import type { ResolvedTheme } from "@opencode-ai/theme/tui"
import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { Store } from "solid-js/store"

export interface Storage {
  store<Value extends object>(
    key: string,
    options: {
      readonly initial: Value
    },
  ): readonly [Store<Value>, (mutation: (draft: Value) => void) => Promise<void>]
}

interface LocationCollection<Value> {
  list(location?: LocationRef): Value[] | undefined
  sync(location?: LocationRef): Promise<void>
  invalidate(location?: LocationRef): void
}

export interface Data {
  readonly on: <Type extends OpenCodeEvent["type"]>(
    type: Type,
    handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
  ) => () => void
  readonly listen: (handler: (event: { details: OpenCodeEvent }) => void) => () => void
  readonly session: {
    list(): SessionInfo[]
    get(sessionID: string): SessionInfo | undefined
    root(sessionID: string): string
    family(sessionID: string): string[]
    cost(sessionID: string): number
    status(sessionID: string): "idle" | "running"
    readonly pending: {
      list(sessionID: string): SessionPendingInfo[]
      sync(sessionID: string): Promise<void>
      invalidate(sessionID: string): void
    }
    sync(sessionID: string): Promise<void>
    invalidate(sessionID: string): void
    readonly message: {
      list(sessionID: string): SessionMessageInfo[]
      get(sessionID: string, messageID: string): SessionMessageInfo | undefined
      sync(sessionID: string): Promise<void>
      invalidate(sessionID: string): void
    }
    readonly permission: {
      list(sessionID: string): PermissionRequest[] | undefined
      sync(sessionID: string): Promise<void>
      invalidate(sessionID: string): void
    }
    readonly form: {
      list(sessionID: string, location?: LocationRef): Array<FormInfo & { readonly location?: LocationRef }> | undefined
      sync(sessionID: string, location?: LocationRef): Promise<void>
      invalidate(sessionID: string, location?: LocationRef): void
    }
  }
  readonly project: {
    readonly permission: {
      list(projectID: string): PermissionSavedInfo[] | undefined
      sync(projectID: string): Promise<void>
      invalidate(projectID: string): void
    }
  }
  readonly shell: {
    list(location?: LocationRef): ShellInfo[]
    get(id: string): ShellInfo | undefined
    sync(location?: LocationRef): Promise<void>
    invalidate(location?: LocationRef): void
  }
  readonly location: {
    default(): LocationRef
    sync(location?: LocationRef): Promise<void>
    invalidate(location?: LocationRef): void
    readonly agent: LocationCollection<AgentInfo>
    readonly command: LocationCollection<CommandInfo>
    readonly integration: LocationCollection<IntegrationInfo>
    readonly mcp: {
      readonly server: LocationCollection<McpServer>
      readonly resource: LocationCollection<McpResource>
    }
    readonly model: LocationCollection<ModelInfo>
    readonly provider: LocationCollection<ProviderInfo>
    readonly reference: LocationCollection<ReferenceInfo>
    readonly skill: LocationCollection<SkillInfo>
  }
}

export type Route =
  | { readonly type: "home" }
  | { readonly type: "session"; readonly sessionID: string }
  | {
      readonly type: "plugin"
      readonly id: string
      readonly name: string
      readonly data?: Record<string, any>
    }

export type Destination = Route | Omit<Extract<Route, { readonly type: "plugin" }>, "id">

export interface Page {
  readonly name: string
  readonly render: (input: { readonly data?: Record<string, any> }) => JSX.Element
}

export interface SlotMap {
  readonly app: Readonly<Record<string, never>>
  readonly "home.footer": Readonly<Record<string, never>>
  readonly "prompt.footer.end": {
    readonly sessionID?: string
    readonly mode: "normal" | "shell"
  }
  readonly "sidebar.content": {
    readonly sessionID: string
  }
  readonly "sidebar.footer": Readonly<Record<string, never>>
}

export type SlotName = keyof SlotMap
export type Slot<Name extends SlotName = SlotName> = (props: SlotMap[Name]) => JSX.Element

export interface App {
  readonly version: string
  readonly channel: string
}

export type ToastVariant = "info" | "success" | "warning" | "error"

export interface ToastOptions {
  readonly title?: string
  readonly message: string
  readonly variant?: ToastVariant
  readonly duration?: number
}

export interface Toast {
  show(options: ToastOptions): void
}

export type AttentionWhen = "always" | "focused" | "blurred"
export type AttentionSoundName = "default" | "question" | "permission" | "error" | "done" | "subagent_done"

export type AttentionNotification =
  | boolean
  | {
      readonly when?: AttentionWhen
    }

export type AttentionSound =
  | boolean
  | {
      readonly name?: AttentionSoundName
      readonly volume?: number
      readonly when?: AttentionWhen
    }

export interface AttentionNotifyOptions {
  readonly title?: string
  readonly message: string
  readonly notification?: AttentionNotification
  readonly sound?: AttentionSound
}

export type AttentionNotifySkipReason =
  | "attention_disabled"
  | "empty_message"
  | "blurred"
  | "focused"
  | "focus_unknown"
  | "renderer_destroyed"

export interface AttentionNotifyResult {
  readonly ok: boolean
  readonly notification: boolean
  readonly sound: boolean
  readonly skipped?: AttentionNotifySkipReason
}

export interface Attention {
  notify(options: AttentionNotifyOptions): Promise<AttentionNotifyResult>
}

export type DialogSize = "medium" | "large" | "xlarge"

export interface DialogOptions {
  readonly size?: DialogSize
  readonly centered?: boolean
}

export interface DialogAlertOptions {
  readonly title: string
  readonly message: string
}

export interface DialogConfirmOptions {
  readonly title: string
  readonly message: string
  readonly label?: {
    readonly confirm?: string
    readonly cancel?: string
  }
}

export interface DialogPromptOptions {
  readonly title: string
  readonly description?: string
  readonly placeholder?: string
  readonly value?: string
}

export interface DialogSelectOption<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
  readonly category?: string
  readonly disabled?: boolean
}

export interface DialogSelectOptions<Value> {
  readonly title: string
  readonly placeholder?: string
  readonly options: readonly DialogSelectOption<Value>[]
  readonly current?: Value
}

export interface Dialog {
  /** Shows a dialog. */
  show(render: () => JSX.Element, onClose?: () => void): void
  /** Sets the active dialog's presentation options. */
  set(options: DialogOptions): void
  /** Closes the active dialog. */
  clear(): void
  alert(options: DialogAlertOptions): Promise<void>
  confirm(options: DialogConfirmOptions): Promise<boolean | undefined>
  prompt(options: DialogPromptOptions): Promise<string | undefined>
  select<Value>(options: DialogSelectOptions<Value>): Promise<Value | undefined>
}

export interface KeymapCommand {
  /** Stable command and config keybind identifier. Omit for an inline command. */
  readonly id?: string
  /** Optional label used by command discovery and keyboard-help UI. */
  readonly title?: string
  /** Optional longer description. */
  readonly description?: string
  /** Groups the command in discovery and keyboard-help UI. */
  readonly group?: string
  /** Enables or disables the command. */
  readonly enabled?: boolean | (() => boolean)
  /** Configures automatic binding, or disables it for a named command. */
  readonly bind?: false | string
  /** Adds a named command to the command palette. */
  readonly palette?: true
  /** Adds a named command to prompt slash completion. */
  readonly slash?: {
    readonly name: string
    readonly aliases?: string[]
    /** Keeps the slash command in the prompt and passes its raw input to run. */
    readonly arguments?: true
  }
  /** Promotes the command in discovery UI. */
  readonly suggested?: boolean | (() => boolean)
  /** Executes the command. Keyboard dispatch includes its event; programmatic dispatch does not. Return false to continue. */
  readonly run: (input?: string, event?: KeyEvent) => void | false | Promise<void>
}

export interface KeymapLayer {
  /** Limits the layer to one OpenCode input mode. Use global to opt out; defaults to base. */
  readonly mode?: string
  /** Enables or disables the complete layer. */
  readonly enabled?: boolean | (() => boolean)
  /** Limits the layer to a focused renderable. */
  readonly target?: () => Renderable | null | undefined
  /** Resolves conflicts with other active layers. */
  readonly priority?: number
  /** Commands owned by this layer. */
  readonly commands?: readonly KeymapCommand[]
  /** IDs of commands whose configured bindings should be active in this layer. */
  readonly bindings?: readonly string[]
}

export interface KeymapPending {
  readonly key: string
  readonly token?: string
}

export interface KeymapActive {
  readonly key: string
  readonly title?: string
  readonly description?: string
  readonly group?: string
  readonly continues: boolean
}

export interface Keymap {
  /** Creates a reactive keymap layer owned by the calling component. */
  layer(input: () => KeymapLayer): void
  /** Dispatches a reachable command by ID. */
  dispatch(id: string, input?: string): void
  /** Returns every formatted shortcut for a registered command. */
  shortcuts(id: string): readonly string[]
  /** Returns the currently reachable commands. Reactive when read in a Solid computation. */
  commands(): readonly KeymapCommand[]
  /** Returns the pending key sequence. Reactive when read in a Solid computation. */
  pending(): readonly KeymapPending[]
  /** Returns bindings reachable from the pending key sequence. Reactive when read in a Solid computation. */
  active(): readonly KeymapActive[]
  /** Controls mutually exclusive OpenCode input modes. */
  readonly mode: {
    /** Returns the active mode. */
    current(): string
    /** Pushes a mode until the returned cleanup is called. */
    push(mode: string): () => void
  }
}

export interface UI {
  readonly dialog: Dialog
  readonly toast: Toast
  readonly format: {
    path(value: string): string
  }
  readonly router: {
    register(page: Page): () => void
    navigate(destination: Destination): void
    current(): Route
  }
  readonly slot: <Name extends SlotName>(name: Name, render: Slot<Name>) => () => void
}

export interface Context {
  readonly options: Readonly<Record<string, any>>
  readonly location: LocationRef | undefined
  readonly app: App
  readonly renderer: CliRenderer
  readonly client: OpenCodeClient
  readonly data: Data
  readonly attention: Attention
  readonly theme: ResolvedTheme
  readonly keymap: Keymap
  readonly storage: Storage
  readonly ui: UI
}

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
  PermissionV2Request,
  ProviderV2Info,
  ReferenceInfo,
  SessionInfo,
  SessionMessageInfo,
  SessionPendingInfo,
  ShellInfo,
  SkillInfo,
} from "@opencode-ai/client"
import type { Renderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"

interface LocationCollection<Value> {
  list(location?: LocationRef): Value[] | undefined
  refresh(location?: LocationRef): Promise<void>
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
      refresh(sessionID: string): Promise<void>
    }
    refresh(sessionID: string): Promise<void>
    readonly message: {
      list(sessionID: string): SessionMessageInfo[]
      get(sessionID: string, messageID: string): SessionMessageInfo | undefined
      refresh(sessionID: string): Promise<void>
    }
    readonly permission: {
      list(sessionID: string): PermissionV2Request[] | undefined
      refresh(sessionID: string): Promise<void>
    }
    readonly form: {
      list(sessionID: string, location?: LocationRef): Array<FormInfo & { readonly location?: LocationRef }> | undefined
      refresh(sessionID: string, location?: LocationRef): Promise<void>
    }
  }
  readonly project: {
    readonly permission: {
      list(projectID: string): PermissionSavedInfo[] | undefined
      refresh(projectID: string): Promise<void>
    }
  }
  readonly shell: {
    list(location?: LocationRef): ShellInfo[]
    get(id: string): ShellInfo | undefined
    refresh(location?: LocationRef): Promise<void>
  }
  readonly location: {
    default(): LocationRef
    refresh(location?: LocationRef): Promise<void>
    readonly agent: LocationCollection<AgentInfo>
    readonly command: LocationCollection<CommandInfo>
    readonly integration: LocationCollection<IntegrationInfo>
    readonly mcp: {
      readonly server: LocationCollection<McpServer>
      readonly resource: LocationCollection<McpResource>
    }
    readonly model: LocationCollection<ModelInfo>
    readonly provider: LocationCollection<ProviderV2Info>
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

export type Slot = (props: Record<string, any>) => JSX.Element

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
  }
  /** Executes the command. Return false to let keymap dispatch continue. */
  readonly run: () => void | false | Promise<void>
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

export interface Keymap {
  /** Creates a reactive keymap layer owned by the calling component. */
  layer(input: () => KeymapLayer): void
  /** Dispatches a reachable command by ID. */
  dispatch(id: string): void
  /** Returns the formatted shortcut for a registered command. */
  shortcut(id: string): string | undefined
  /** Controls mutually exclusive OpenCode input modes. */
  readonly mode: {
    /** Returns the active mode. */
    current(): string
    /** Pushes a mode until the returned cleanup is called. */
    push(mode: string): () => void
  }
}

export interface UI {
  readonly router: {
    register(page: Page): () => void
    navigate(destination: Destination): void
    current(): Route
  }
  readonly slot: (name: string, render: Slot) => () => void
}

export interface Context {
  readonly options: Readonly<Record<string, any>>
  readonly location: LocationRef | undefined
  readonly client: OpenCodeClient
  readonly data: Data
  readonly keymap: Keymap
  readonly ui: UI
}

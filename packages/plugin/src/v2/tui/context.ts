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

export interface RouteDefinition {
  readonly name: string
  readonly render: (input: { readonly params: any }) => JSX.Element
}

export interface Route {
  register(definition: RouteDefinition): () => void
  navigate(input: { readonly name: string; readonly params?: any }): void
  current(): {
    readonly name: string
    readonly params: any
  }
}

export interface UI {
  readonly route: Route
}

export interface Context {
  readonly options: Readonly<Record<string, unknown>>
  readonly client: OpenCodeClient
  readonly data: Data
  readonly ui: UI
}

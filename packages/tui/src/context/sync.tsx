import type {
  Agent,
  Command,
  Config,
  ConsoleState,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  FileDiffInfo,
  Todo,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useProject } from "./project"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const project = useProject()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: Record<string, PermissionRequest[]>
      question: Record<string, QuestionRequest[]>
      config: Config
      session: Session[]
      session_diff: Record<string, FileDiffInfo[]>
      todo: Record<string, Todo[]>
      message: Record<string, Message[]>
      part: Record<string, Part[]>
      lsp: LspStatus[]
      mcp: Record<string, McpStatus>
      mcp_resource: Record<string, McpResource>
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      status: "complete",
      provider: [],
      provider_default: {},
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      agent: [],
      command: [],
      permission: {},
      question: {},
      config: {},
      session: [],
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    return {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return true
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(_sessionID: string) {
          return undefined as Session | undefined
        },
        query() {
          return {} as { scope?: "project"; path?: string }
        },
        async refresh() {},
        status(_sessionID: string) {
          return "idle" as const
        },
        async sync(_sessionID: string) {},
      },
      async bootstrap(_input: { fatal?: boolean } = {}) {},
    }
  },
})

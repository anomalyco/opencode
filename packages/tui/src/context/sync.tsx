import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  Provider,
  QuestionRequest,
  Session,
  FileDiffInfo,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useProject } from "./project"

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
      agent: Agent[]
      command: Command[]
      permission: Record<string, PermissionRequest[]>
      question: Record<string, QuestionRequest[]>
      config: Config
      session: Session[]
      session_diff: Record<string, FileDiffInfo[]>
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
      agent: [],
      command: [],
      permission: {},
      question: {},
      config: {},
      session: [],
      session_diff: {},
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

import type { Agent, Config, LspStatus, Path, ProviderListResponse, VcsInfo } from "@/runtime/server/types"
import type { ReferenceInfo } from "@opencode-ai/client/promise"
import type { CommandInfo, McpResource, McpServer } from "@opencode-ai/client/promise"
import type { Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import { IconState, ProjectState, VcsState } from "../persistence"

export type ProjectMeta = NonNullable<typeof ProjectState.Type.value>

export type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  command: CommandInfo[]
  reference: ReferenceInfo[]
  project: string
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
  provider_ready: boolean
  provider: ProviderListResponse
  config: Config
  path: Path
  mcp_ready: boolean
  mcp: {
    [name: string]: McpServer["status"]
  }
  mcp_resource: {
    [key: string]: McpResource
  }
  lsp_ready: boolean
  lsp: LspStatus[]
  vcs: VcsInfo | undefined
}

export type VcsCache = {
  store: Store<typeof VcsState.Type>
  setStore: SetStoreFunction<typeof VcsState.Type>
  ready: Accessor<boolean>
}

export type MetaCache = {
  store: Store<typeof ProjectState.Type>
  setStore: SetStoreFunction<typeof ProjectState.Type>
  ready: Accessor<boolean>
}

export type IconCache = {
  store: Store<typeof IconState.Type>
  setStore: SetStoreFunction<typeof IconState.Type>
  ready: Accessor<boolean>
}

export type ChildOptions = {
  bootstrap?: boolean
  mcp?: boolean
}

export type DirState = {
  lastAccessAt: number
}

export type EvictPlan = {
  stores: string[]
  state: Map<string, DirState>
  pins: Set<string>
  max: number
  ttl: number
  now: number
}

export type DisposeCheck = {
  directory: string
  hasStore: boolean
  pinned: boolean
  booting: boolean
  loadingSessions: boolean
}

export const MAX_DIR_STORES = 30
export const DIR_IDLE_TTL_MS = 20 * 60 * 1000
export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000
export const SESSION_RECENT_LIMIT = 50

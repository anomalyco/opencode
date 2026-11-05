import type {
  Agent,
  Config,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  VcsInfo,
} from "@/runtime/server/types"
import type { ReferenceInfo } from "@opencode/client/promise"
import type { CommandInfo, McpResource } from "@opencode/client/promise"
import { ProjectState } from "../persistence"

export type ProjectMeta = NonNullable<typeof ProjectState.Type.value>

export type GlobalStore = {
  path: Path
  project: Project[]
  provider_auth: ProviderAuthResponse
  config: Config
}

export type State = {
  agent: Agent[]
  command: CommandInfo[]
  reference: ReferenceInfo[]
  project: string
  projectMeta: ProjectMeta | undefined
  provider_ready: boolean
  provider: ProviderListResponse
  config: Config
  path: Path
  mcp_ready: boolean
  mcp_resource: {
    [key: string]: McpResource
  }
  vcs: VcsInfo | undefined
}

export const MAX_DIR_STORES = 30

export const DIR_IDLE_TTL_MS = 20 * 60 * 1000

export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000

export const SESSION_RECENT_LIMIT = 50

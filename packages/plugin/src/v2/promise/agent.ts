import type { AgentApi } from "@opencode-ai/client/promise/api"
import type { AgentDraft } from "../effect/agent.js"
import type { Transform } from "./registration.js"

export type { AgentDraft }

export interface AgentDomain extends AgentApi {
  readonly get: (id: string) => Promise<AgentGetOutput | undefined>
  readonly transform: Transform<AgentDraft>
  readonly reload: () => Promise<void>
}

type AgentGetOutput = Awaited<ReturnType<AgentApi["list"]>>["data"][number]

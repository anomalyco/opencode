import type { Agent } from "../agent.js"
import type { Permission } from "../permission.js"
import type { SessionSchema } from "../session/schema.js"

export type Invocation = ReturnType<typeof Permission.invocation>

/** A tool call belongs to the model request that issued it, even if the Session has since switched agents. */
export function matchesAuthor(owner: SessionSchema.Info, agent: Agent.Info | undefined, invocation: Invocation) {
  return invocation.sessionID === owner.id && invocation.agent === agent?.id
}

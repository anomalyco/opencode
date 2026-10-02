import type { ClientCapabilities } from "@agentclientprotocol/sdk"

export const ChildSessionUpdates = "opencode/child-session-updates"

export type Capabilities = {
  readonly childSessionUpdates: boolean
  readonly formElicitation: boolean
  readonly compaction: boolean
}

export function parse(client: ClientCapabilities | undefined) {
  const elicitation = client?.elicitation
  const compaction = client?.session?.compaction
  return {
    childSessionUpdates: client?._meta?.[ChildSessionUpdates] === true,
    formElicitation: elicitation?.form !== undefined && elicitation.form !== null,
    compaction: compaction !== undefined && compaction !== null,
  }
}

export * as ACPCapabilities from "./capabilities"

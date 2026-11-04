import type { StreamCommit } from "./types"

export function turnSummaryCommit(input: {
  agent: string
  model: string
  duration: string
  messageID?: string
}): StreamCommit {
  return {
    kind: "system",
    text: `${input.agent} · ${input.model} · ${input.duration}`,
    phase: "final",
    source: "system",
    summary: {
      agent: input.agent,
      model: input.model,
      duration: input.duration,
    },
    messageID: input.messageID,
  }
}

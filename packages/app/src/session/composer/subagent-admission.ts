import type { JsonValue, SessionInfo } from "@opencode/client/promise"
import { createSessionAdmitted } from "@/session/composer/adapter"
import { admitPrompt, type PromptAdmission, type PromptSession } from "@/composer/admission"

type Metadata = Record<string, JsonValue>

type SubagentData = {
  session: {
    get: (sessionID: string) => SessionInfo
    status: (sessionID: string) => string
    input: { has: (sessionID: string, messageID: string) => boolean }
    message: { get: (sessionID: string, messageID: string) => object | undefined }
  } & PromptSession["data"]["session"]
}

/**
 * A message to one subagent Session, steered into the run it has or into the run it resumes. It carries the
 * session's own agent and model for the transcript's attribution only: the server runs each step from the Session
 * record, so a message never reconfigures the child.
 */
export function sendSubagentMessage(input: { data: SubagentData; sessionID: string; id: string; text: string }) {
  return admitPrompt({
    session: {
      id: input.sessionID,
      data: input.data,
      admitted: createSessionAdmitted(input.data, input.sessionID),
    },
    id: input.id,
    working: input.data.session.status(input.sessionID) === "running",
    admission: {
      id: input.id,
      sessionID: input.sessionID,
      delivery: "steer",
      text: input.text,
      metadata: attribution(input.data.session.get(input.sessionID), input.text),
    },
  })
}

// Prompt metadata is an open JSON dictionary by contract; the keys below are the ones attribution records.
function attribution(info: SessionInfo | undefined, text: string): PromptAdmission["metadata"] {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- see above
  const metadata: Metadata = { displayText: text }

  if (info?.agent) metadata.agent = info.agent

  if (info?.model) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- see above
    const model: Metadata = { providerID: info.model.providerID, modelID: info.model.id }

    if (info.model.variant) model.variant = info.model.variant
    metadata.model = model
  }

  return metadata
}

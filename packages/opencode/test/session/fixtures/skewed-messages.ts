import { Identifier } from "../../../src/id/id"
import { MessageV2 } from "../../../src/session/message-v2"
import { MessageID, SessionID } from "../../../src/session/schema"
import { ModelID, ProviderID } from "../../../src/provider/schema"

export function makeUser(
  id: MessageID,
  opts?: Partial<MessageV2.User>,
): MessageV2.User {
  return {
    id,
    sessionID: SessionID.make("test-session"),
    role: "user",
    time: { created: Date.now() },
    agent: "default",
    model: {
      providerID: ProviderID.openai,
      modelID: ModelID.make("gpt-4"),
    },
    ...opts,
  }
}

export function makeAssistant(
  id: MessageID,
  parentID: MessageID,
  opts?: Partial<MessageV2.Assistant>,
): MessageV2.Assistant {
  return {
    id,
    sessionID: SessionID.make("test-session"),
    role: "assistant",
    parentID,
    time: { created: Date.now() },
    modelID: ModelID.make("gpt-4"),
    providerID: ProviderID.openai,
    mode: "default",
    agent: "default",
    path: {
      cwd: "/tmp",
      root: "/tmp",
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    finish: "stop",
    ...opts,
  }
}

export function aheadPair(): {
  user: MessageV2.User
  assistant: MessageV2.Assistant
} {
  const now = Date.now()
  const userID = MessageID.make(Identifier.create("message", false, now + 60_000))
  const assistantID = MessageID.make(Identifier.create("message", false, now))

  return {
    user: makeUser(userID),
    assistant: makeAssistant(assistantID, userID),
  }
}

export function behindPair(): {
  user: MessageV2.User
  assistant: MessageV2.Assistant
} {
  const now = Date.now()
  const userID = MessageID.make(Identifier.create("message", false, now - 60_000))
  const assistantID = MessageID.make(Identifier.create("message", false, now))

  return {
    user: makeUser(userID),
    assistant: makeAssistant(assistantID, userID),
  }
}

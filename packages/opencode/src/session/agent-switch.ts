import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Session } from "./session"
import { Provider } from "@/provider/provider"
import { MessageID, PartID, type SessionID } from "./schema"

/**
 * Continues a session with a different agent by appending a synthetic user
 * message. The session loop picks the agent for the next turn from the last
 * user message, so this is how plan mode hands work over to the build agent.
 */
export const switchAgent = Effect.fn("Session.switchAgent")(function* (input: {
  session: Session.Interface
  provider: Provider.Interface
  sessionID: SessionID
  agent: string
  text: string
}) {
  const messages = yield* input.session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
  const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
  const model =
    lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* input.provider.defaultModel()

  const msg: SessionV1.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.agent,
    model,
  }
  yield* input.session.updateMessage(msg)
  yield* input.session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: input.sessionID,
    type: "text",
    text: input.text,
    synthetic: true,
  } satisfies SessionV1.TextPart)
})

export * as SessionAgentSwitch from "./agent-switch"

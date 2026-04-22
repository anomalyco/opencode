import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { MessageID, SessionID } from "../../session/schema"
import { SessionStatus } from "../../session/status"

type UserMessage = MessageV2.WithParts & { info: MessageV2.User }
type SendInput = {
  sessionID: SessionID
  agent: string
  text: string
  wrap?: boolean
  dedup?: boolean
  busy?: number
  idle?: number
  sleepMs?: number
}

function text(msg?: MessageV2.WithParts, max = 4_000) {
  const out = msg?.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && part.synthetic === true)
    .map((part) => part.text)
    .join("")
  if (!out) return ""
  if (out.length <= max) return out
  return out.slice(0, max - 3) + "..."
}

function synthetic(msg?: MessageV2.WithParts) {
  return (
    !!msg &&
    msg.info.role === "user" &&
    msg.parts.length > 0 &&
    msg.parts.every((part) => part.type === "text" && part.synthetic === true)
  )
}

function last(msgs: MessageV2.WithParts[]) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (synthetic(msg)) return msg as UserMessage
  }
}

export function remind(text: string) {
  return [
    "<system-reminder>",
    "Synthetic async task delivery. This is continuation context for the current work, not a new user request.",
    "",
    text,
    "</system-reminder>",
  ].join("\n")
}

export async function handled(sessionID: SessionID, deliveryID: MessageID) {
  const msgs = await Session.messages({ sessionID })
  return msgs.some(
    (item): item is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      item.info.role === "assistant" && item.info.parentID === deliveryID,
  )
}

export async function send(input: SendInput) {
  const body = input.wrap === false ? input.text : remind(input.text)
  if (input.dedup) {
    const msgs = await Session.messages({ sessionID: input.sessionID }).catch(() => [] as MessageV2.WithParts[])
    if (text(last(msgs)) === body) return
  }
  const busy = (await SessionStatus.get(input.sessionID)).type !== "idle"
  const msg = await SessionPrompt.prompt({
    sessionID: input.sessionID,
    agent: input.agent,
    noReply: true,
    parts: [{ type: "text", text: body, synthetic: true }],
  })
  const max = busy ? input.busy ?? 6 : input.idle ?? 2
  for (let attempt = 0; attempt < max; attempt++) {
    await SessionPrompt.loop({ sessionID: input.sessionID }).catch(() => undefined)
    if (await handled(input.sessionID, msg.info.id)) return
    const next = await SessionStatus.get(input.sessionID).catch(() => ({ type: "idle" as const }))
    if (next.type === "idle") continue
    if (attempt + 1 >= max) continue
    await Bun.sleep(input.sleepMs ?? 25)
  }
  const next = await SessionStatus.get(input.sessionID).catch(() => ({ type: "idle" as const }))
  if (next.type !== "idle") return
  await SessionPrompt.loop({ sessionID: input.sessionID }).catch(() => undefined)
}

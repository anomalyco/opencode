export type RoutingInput = {
  chatType: "direct" | "group"
  chatID: string
  senderID: string
  messageID: string
  threadID?: string
  rootID?: string
}

export type GatewayIdentity = {
  conversationID: string
  sessionID: string
  promptMessageID: string
  taskID: string
  turnID: string
  traceID: string
}

const namespaces = {
  conversation: "feishu-conversation:v1",
  session: "feishu-session:v1",
  prompt: "feishu-prompt:v1",
  task: "feishu-task:v1",
  turn: "feishu-turn:v1",
  trace: "feishu-trace:v1",
}

export async function deriveGatewayIdentity(input: RoutingInput): Promise<GatewayIdentity> {
  const conversation =
    input.chatType === "direct"
      ? `feishu:direct:${input.chatID}:${input.senderID}`
      : `feishu:thread:${input.chatID}:${input.threadID ?? input.rootID ?? input.messageID}`

  const [conversationID, sessionID, promptMessageID, taskID, turnID, traceID] = await Promise.all([
    hashID(namespaces.conversation, "conv_", conversation),
    hashID(namespaces.session, "ses_feishu_", conversation),
    hashID(namespaces.prompt, "msg_feishu_", input.messageID),
    hashID(namespaces.task, "task_", input.messageID),
    hashID(namespaces.turn, "turn_", input.messageID),
    hashID(namespaces.trace, "trace_", input.messageID),
  ])

  return { conversationID, sessionID, promptMessageID, taskID, turnID, traceID }
}

export async function hashID(namespace: string, prefix: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${namespace}\0${value}`))
  return prefix + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 48)
}

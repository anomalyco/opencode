import { exchanges, messages } from "../../utils/markdown-sessions"

export const workload = {
  fixture: "long-complex-markdown-v1",
  exchangesPerSession: exchanges,
  messagesPerSession: exchanges * 2,
  history: "full fixture history in one response",
  sessions: Object.fromEntries(
    Object.entries(messages).map(([sessionID, items]) => [
      sessionID,
      {
        payloadBytes: Buffer.byteLength(JSON.stringify(items)),
        markdownBytes: items.reduce(
          (total, message) =>
            total +
            (message.type === "assistant"
              ? message.content.reduce(
                  (size, part) => size + (part.type === "text" ? Buffer.byteLength(part.text) : 0),
                  0,
                )
              : 0),
          0,
        ),
      },
    ]),
  ),
}

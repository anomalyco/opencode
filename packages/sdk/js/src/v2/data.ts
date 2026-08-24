import type { Part, UserMessage } from "./client.js"

const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastTimestamp = 0
let counter = 0

// Mirrors the monotonic, time-ordered ID scheme the server uses so builder output sorts
// alongside server-generated records. The SDK cannot import @opencode-ai/schema (it must stay
// dependency-free), so the generator is inlined here.
function identifier(prefix: string) {
  const timestamp = Date.now()
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++

  const current = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((current >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return prefix + "_" + time + Array.from(bytes, (byte) => chars[byte % 62]).join("")
}

export const message = {
  user(input: Omit<UserMessage, "role" | "time" | "id"> & { parts: Omit<Part, "id" | "sessionID" | "messageID">[] }): {
    info: UserMessage
    parts: Part[]
  } {
    const { parts: _parts, ...rest } = input

    const info: UserMessage = {
      ...rest,
      id: identifier("msg"),
      time: {
        created: Date.now(),
      },
      role: "user",
    }

    return {
      info,
      parts: input.parts.map(
        (part) =>
          ({
            ...part,
            id: identifier("prt"),
            messageID: info.id,
            sessionID: info.sessionID,
          }) as Part,
      ),
    }
  },
}

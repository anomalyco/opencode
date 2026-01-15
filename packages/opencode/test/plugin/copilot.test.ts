import { describe, expect, test } from "bun:test"

const SYNTHETIC_PATTERNS = [
  /^Tool \w+ returned an attachment:/,
  /^What did we do so far\?/,
  /^The following tool was executed by the user$/,
  /^Tool result:/i,
  /^Tool output:/i,
]

function isSynthetic(text: string): boolean {
  if (!text || typeof text !== "string") return false
  const trimmed = text.trim()
  return SYNTHETIC_PATTERNS.some((p) => p.test(trimmed))
}

function hasSyntheticContent(content: unknown): boolean {
  if (typeof content === "string") return isSynthetic(content)
  if (!Array.isArray(content)) return false
  return content.some((part: any) => isSynthetic(part.text || part.content || ""))
}

function detectAgent(messages: any[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false

  const hasNonUser = messages.some((msg: any) => ["assistant", "tool"].includes(msg.role))
  if (hasNonUser) return true

  const users = messages.filter((msg: any) => msg.role === "user")
  if (users.length > 1) return true

  return users.some((msg: any) => hasSyntheticContent(msg.content))
}

function getInitiator(body: any): "user" | "agent" {
  const messages = body?.messages || body?.input || []
  return detectAgent(messages) ? "agent" : "user"
}

describe("plugin.copilot", () => {
  describe("isSynthetic", () => {
    test("detects tool attachment pattern", () => {
      expect(isSynthetic("Tool read_file returned an attachment:")).toBe(true)
      expect(isSynthetic("Tool bash returned an attachment:")).toBe(true)
    })

    test("detects compaction pattern", () => {
      expect(isSynthetic("What did we do so far?")).toBe(true)
      expect(isSynthetic("What did we do so far? ")).toBe(true)
    })

    test("detects subtask pattern", () => {
      expect(isSynthetic("The following tool was executed by the user")).toBe(true)
    })

    test("ignores normal user messages", () => {
      expect(isSynthetic("Hello, can you help me?")).toBe(false)
      expect(isSynthetic("Read the file README.md")).toBe(false)
      expect(isSynthetic("What did we do yesterday?")).toBe(false)
    })

    test("handles empty and invalid input", () => {
      expect(isSynthetic("")).toBe(false)
      expect(isSynthetic(null as any)).toBe(false)
      expect(isSynthetic(undefined as any)).toBe(false)
    })
  })

  describe("detectAgent", () => {
    test("first user message returns user", () => {
      const body = { messages: [{ role: "user", content: "Hello" }] }
      expect(getInitiator(body)).toBe("user")
    })

    test("empty messages returns user", () => {
      expect(getInitiator({ messages: [] })).toBe("user")
      expect(getInitiator({})).toBe("user")
      expect(getInitiator(null)).toBe("user")
    })

    test("assistant message returns agent", () => {
      const body = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("tool message returns agent", () => {
      const body = {
        messages: [
          { role: "user", content: "Run test" },
          { role: "tool", content: "Test passed" },
        ],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("multiple user messages returns agent", () => {
      const body = {
        messages: [
          { role: "user", content: "First" },
          { role: "user", content: "Second" },
        ],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("synthetic tool attachment returns agent", () => {
      const body = {
        messages: [{ role: "user", content: "Tool read_file returned an attachment:" }],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("synthetic compaction returns agent", () => {
      const body = {
        messages: [{ role: "user", content: "What did we do so far? " }],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("synthetic with array content returns agent", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Tool bash returned an attachment:" },
              { type: "file", url: "file://out.txt" },
            ],
          },
        ],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("responses API format works", () => {
      expect(getInitiator({ input: [{ role: "user", content: "Hello" }] })).toBe("user")
      expect(
        getInitiator({
          input: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
          ],
        }),
      ).toBe("agent")
    })
  })

  describe("regression: issue #8030 and #8067", () => {
    test("synthetic user message after conversation does not charge premium", () => {
      const body = {
        messages: [
          { role: "user", content: "Read file.txt" },
          { role: "assistant", content: "Reading..." },
          { role: "user", content: "Tool read_file returned an attachment:" },
        ],
      }
      expect(getInitiator(body)).toBe("agent")
    })

    test("multi-turn with real user follow-up does not charge premium", () => {
      const body = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "Now do something else" },
        ],
      }
      expect(getInitiator(body)).toBe("agent")
    })
  })
})

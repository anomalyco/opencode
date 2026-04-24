import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

const SESSION_ID = Identifier.descending("session")
const MESSAGE_ID = Identifier.ascending("message")

describe("parentAgent hook input", () => {
  test("PromptInput accepts parentAgent", () => {
    const input = SessionPrompt.PromptInput.zod.parse({
      sessionID: SESSION_ID,
      agent: "scout",
      parentAgent: "coder",
      parts: [{ type: "text", text: "test" }],
    })
    expect(input.parentAgent).toBe("coder")
  })

  test("PromptInput parentAgent is optional", () => {
    const input = SessionPrompt.PromptInput.zod.parse({
      sessionID: SESSION_ID,
      agent: "scout",
      parts: [{ type: "text", text: "test" }],
    })
    expect(input.parentAgent).toBeUndefined()
  })

  test("ShellInput accepts parentAgent", () => {
    const input = SessionPrompt.ShellInput.zod.parse({
      sessionID: SESSION_ID,
      agent: "coder",
      parentAgent: "orchestrator",
      command: "ls",
    })
    expect(input.parentAgent).toBe("orchestrator")
  })

  test("UserMessage stores parentAgent", () => {
    const msg = MessageV2.User.zod.parse({
      id: MESSAGE_ID,
      sessionID: SESSION_ID,
      role: "user",
      time: { created: Date.now() },
      agent: "scout",
      parentAgent: "coder",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    })
    expect(msg.parentAgent).toBe("coder")
  })

  test("UserMessage parentAgent is optional", () => {
    const msg = MessageV2.User.zod.parse({
      id: MESSAGE_ID,
      sessionID: SESSION_ID,
      role: "user",
      time: { created: Date.now() },
      agent: "coder",
      model: { providerID: "openai", modelID: "gpt-5.4" },
    })
    expect(msg.parentAgent).toBeUndefined()
  })
})

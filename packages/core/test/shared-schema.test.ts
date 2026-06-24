import { expect, test } from "bun:test"
import { Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV2 } from "@opencode-ai/core/session"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Prompt } from "@opencode-ai/schema/prompt"
import { Session } from "@opencode-ai/schema/session"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"

test("Core reuses the canonical shared schemas", async () => {
  const [coreLocation, coreSessionInput, coreSessionMessage, corePrompt] = await Promise.all([
    import("@opencode-ai/core/location"),
    import("@opencode-ai/core/session/input"),
    import("@opencode-ai/core/session/message"),
    import("@opencode-ai/core/session/prompt"),
  ])

  expect(AgentV2.ID).toBe(Agent.ID)
  expect(coreLocation.Ref).toBe(Location.Ref)
  expect(ModelV2.Ref).toBe(Model.Ref)
  expect(SessionV2.Info).toBe(Session.Info)
  expect(coreSessionInput.Admitted).toBe(SessionInput.Admitted)
  expect(coreSessionMessage.Message).toBe(SessionMessage.Message)
  expect(corePrompt.Prompt).toBe(Prompt)
})

test("shared record schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
  expect(Prompt.equivalence(Prompt.make({ text: "hello" }), decoded)).toBe(true)
  expect(Prompt.fromUserMessage({ text: "hello" })).toEqual(made)
  expect(Workspace.ID.ascending("")).toStartWith("wrk_")
})

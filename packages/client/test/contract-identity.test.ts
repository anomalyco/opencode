import { expect, test } from "bun:test"
import { Schema } from "effect"
import { AgentV2 } from "@bolt-ai/core/agent"
import { Location as CoreLocation } from "@bolt-ai/core/location"
import { ModelV2 } from "@bolt-ai/core/model"
import { SessionV2 } from "@bolt-ai/core/session"
import { SessionInput as CoreSessionInput } from "@bolt-ai/core/session/input"
import { SessionMessage as CoreSessionMessage } from "@bolt-ai/core/session/message"
import { Prompt as CorePrompt } from "@bolt-ai/core/session/prompt"
import { Agent } from "@bolt-ai/schema/agent"
import { Location } from "@bolt-ai/schema/location"
import { Model } from "@bolt-ai/schema/model"
import { Project } from "@bolt-ai/schema/project"
import { Provider } from "@bolt-ai/schema/provider"
import { Prompt } from "@bolt-ai/schema/prompt"
import { Session } from "@bolt-ai/schema/session"
import { SessionInput } from "@bolt-ai/schema/session-input"
import { SessionMessage } from "@bolt-ai/schema/session-message"
import { Workspace } from "@bolt-ai/schema/workspace"
import { Api } from "@bolt-ai/server/api"
import { compile, emitPromise } from "@bolt-ai/httpapi-codegen"
import { ClientApi, endpointNames, groupNames, omitEndpoints } from "../src/contract"

const Client = await import("../src/effect")

test("effect entrypoint exposes canonical Schema contracts", () => {
  expect(Client.Agent).toBe(Agent)
  expect(Client.Config).toBe(Config)
  expect(Client.Model).toBe(Model)
  expect(Client.Session).toBe(Session)
  expect(Client.Vcs.Base).toBe(Vcs.Base)
})

test("generated Effect API names canonical and composed outputs", async () => {
  const source = await Bun.file(new URL("../src/effect/api/api.ts", import.meta.url)).text()

  expect(source).toContain("export type SessionGetOutput = Session.Info")
  expect(source).toContain("export type EventSubscribeOutput = OpenCodeEvent")
  expect(source).not.toContain("HttpApiClient.ForApi")
})

test("shared DTO schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
})

import { expect, test } from "bun:test"
import { Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Location as CoreLocation } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionInput as CoreSessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage as CoreSessionMessage } from "@opencode-ai/core/session/message"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { Prompt } from "@opencode-ai/schema/prompt"
import { Session } from "@opencode-ai/schema/session"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Api } from "@opencode-ai/server/api"
import { compile, emitPromise } from "@opencode-ai/httpapi-codegen"
import { ClientApi, groupNames, promiseOmitEndpoints } from "../src/contract"

const Client = await import("../src/effect")

test("effect entrypoint exposes canonical Schema contracts", () => {
  expect(Client.Agent).toBe(Agent)
  expect(Client.Model).toBe(Model)
  expect(Client.Session).toBe(Session)
})

test("Core and Server reuse the authoritative Schema and Protocol values", () => {
  expect(AgentV2.ID).toBe(Agent.ID)
  expect(CoreLocation.Ref).toBe(Location.Ref)
  expect(ModelV2.Ref).toBe(Model.Ref)
  expect(SessionV2.Info).toBe(Session.Info)
  expect(ProjectV2.Current).toBe(Project.Current)
  expect(ProjectV2.Directory).toBe(Project.Directory)
  expect(ProjectV2.Directories).toBe(Project.Directories)
  expect(CoreSessionInput.Message).toBe(SessionInput.Message)
  expect(CoreSessionInput.User).toBe(SessionInput.User)
  expect(CoreSessionInput.Synthetic).toBe(SessionInput.Synthetic)
  expect(CoreSessionMessage.Info).toBe(SessionMessage.Info)
  expect(Api.groups["server.session"].identifier).toBe("server.session")
  expect(Api.groups["server.project"].identifier).toBe("server.project")
  expect(Object.keys(ClientApi.groups)).toEqual(Object.keys(Api.groups))
  expect(Session.ID.create()).toStartWith("ses_")
  expect(Project.ID.global).toBe("global")
  expect(Provider.ID.anthropic).toBe("anthropic")
  expect(Workspace.ID.create()).toStartWith("wrk_")
})

test("client and Server contracts generate identically", () => {
  const server = compile(Api, { groupNames, omitEndpoints: promiseOmitEndpoints })
  const client = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })

  expect(emitPromise(client)).toEqual(emitPromise(server))
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
  expect(CoreSessionMessage.AssistantText).toBe(SessionMessage.AssistantText)
})

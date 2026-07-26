import { expect, test } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Location as CoreLocation } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionPending as CoreSessionPending } from "@opencode-ai/core/session/pending"
import { SessionMessage as CoreSessionMessage } from "@opencode-ai/core/session/message"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { WebSearch } from "@opencode-ai/schema/websearch"
import { Session } from "@opencode-ai/schema/session"
import { SessionPending } from "@opencode-ai/schema/session-pending"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Api } from "@opencode-ai/server/api"
import { ClientApi, groupNames, promiseOmitEndpoints } from "@opencode-ai/protocol/client"
import { compile, emitPromise } from "@opencode-ai/httpapi-codegen"

const SDK = await import("../src/index")

test("re-exports canonical contracts directly from Schema", () => {
  expect(SDK.Agent).toBe(Agent)
  expect(SDK.Model).toBe(Model)
  expect(SDK.WebSearch).toBe(WebSearch)
  expect(SDK.Session).toBe(Session)
  expect(Object.keys(SDK).sort()).toEqual([
    "AbsolutePath",
    "Agent",
    "ClientError",
    "Command",
    "Credential",
    "FileSystem",
    "Integration",
    "Location",
    "Model",
    "OpenCode",
    "Permission",
    "PermissionSaved",
    "Project",
    "ProjectCopy",
    "Prompt",
    "PromptInput",
    "Provider",
    "Pty",
    "Question",
    "Reference",
    "RelativePath",
    "Session",
    "SessionMessage",
    "SessionPending",
    "Skill",
    "Tool",
    "WebSearch",
  ])
})

test("Core and Server reuse the authoritative Schema and Protocol values", () => {
  expect(AgentV2.ID).toBe(Agent.ID)
  expect(CoreLocation.Ref).toBe(Location.Ref)
  expect(ModelV2.Ref).toBe(Model.Ref)
  expect(SessionV2.Info).toBe(Session.Info)
  expect(ProjectV2.Current).toBe(Project.Current)
  expect(ProjectV2.Directory).toBe(Project.Directory)
  expect(ProjectV2.Directories).toBe(Project.Directories)
  expect(CoreSessionPending.Message).toBe(SessionPending.Message)
  expect(CoreSessionPending.User).toBe(SessionPending.User)
  expect(CoreSessionPending.Synthetic).toBe(SessionPending.Synthetic)
  expect(CoreSessionMessage.Info).toBe(SessionMessage.Info)
  expect(CoreSessionMessage.AssistantText).toBe(SessionMessage.AssistantText)
  expect(Api.groups["server.session"].identifier).toBe("server.session")
  expect(Api.groups["server.project"].identifier).toBe("server.project")
  expect(Object.keys(ClientApi.groups)).toEqual(Object.keys(Api.groups))
  expect(Session.ID.create()).toStartWith("ses_")
  expect(String(Project.ID.global)).toBe("global")
  expect(String(Provider.ID.anthropic)).toBe("anthropic")
  expect(Workspace.ID.create()).toStartWith("wrk_")
})

test("client and Server contracts generate identically", () => {
  const server = compile(Api, { groupNames, omitEndpoints: promiseOmitEndpoints })
  const client = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })

  expect(emitPromise(client)).toEqual(emitPromise(server))
})

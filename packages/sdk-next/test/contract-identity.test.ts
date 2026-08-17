import { expect, test } from "bun:test"
import { Location as CoreLocation } from "@opencode-ai/core/location"
import { SessionInbox as CoreSessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage as CoreSessionMessage } from "@opencode-ai/core/session/message"
import { Agent } from "@opencode-ai/schema/agent"
import { Config } from "@opencode-ai/schema/config"
import { Event } from "@opencode-ai/schema/event"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { WebSearch } from "@opencode-ai/schema/websearch"
import { Session } from "@opencode-ai/schema/session"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Api } from "@opencode-ai/server/api"
import { ClientApi, groupNames, promiseOmitEndpoints } from "@opencode-ai/protocol/client"
import { compile, emitPromise } from "@opencode-ai/httpapi-codegen"

const SDK = await import("../src/index")
const CoreAgent = await import("@opencode-ai/core/agent")
const CoreModel = await import("@opencode-ai/core/model")
const CoreProject = await import("@opencode-ai/core/project")
const CoreSession = await import("@opencode-ai/core/session")
const CoreWorktree = await import("@opencode-ai/core/worktree")

test("re-exports canonical contracts directly from Schema", () => {
  expect(SDK.Agent).toBe(Agent)
  expect(SDK.Config).toBe(Config)
  expect(SDK.Event).toBe(Event)
  expect(SDK.Model).toBe(Model)
  expect(SDK.WebSearch).toBe(WebSearch)
  expect(SDK.Session).toBe(Session)
  expect(SDK.Worktree).toBe(Worktree)
  expect(SDK.Workspace).toBe(Workspace)
  expect(Object.keys(SDK).sort()).toEqual([
    "AbsolutePath",
    "Agent",
    "ClientError",
    "Command",
    "Config",
    "Credential",
    "Event",
    "FileSystem",
    "Integration",
    "Location",
    "Model",
    "OpenCode",
    "Permission",
    "PermissionSaved",
    "Project",
    "Prompt",
    "PromptInput",
    "Provider",
    "Pty",
    "Question",
    "Reference",
    "RelativePath",
    "Session",
    "SessionInbox",
    "SessionMessage",
    "Skill",
    "Tool",
    "WebSearch",
    "Workspace",
    "Worktree",
  ])
})

test("Core and Server reuse the authoritative Schema and Protocol values", () => {
  expect(CoreAgent.ID).toBe(Agent.ID)
  expect(CoreLocation.Ref).toBe(Location.Ref)
  expect(CoreModel.Ref).toBe(Model.Ref)
  expect(CoreSession.Info).toBe(Session.Info)
  expect(CoreProject.Current).toBe(Project.Current)
  expect(CoreWorktree.DirectoryUnavailableError).toBeDefined()
  expect(CoreWorktree.List).toBe(Worktree.List)
  expect(CoreWorktree.Info).toBe(Worktree.Info)
  expect(CoreSessionInbox.Item).toBe(SessionInbox.Item)
  expect(CoreSessionInbox.User).toBe(SessionInbox.User)
  expect(CoreSessionInbox.Synthetic).toBe(SessionInbox.Synthetic)
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

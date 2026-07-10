import { expect, test } from "bun:test"
import { Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV2 } from "@opencode-ai/core/session"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Project } from "@opencode-ai/schema/project"
import { ProjectDirectories } from "@opencode-ai/schema/project-directories"
import { PermissionV1 } from "@opencode-ai/schema/permission-v1"
import { Prompt } from "@opencode-ai/schema/prompt"
import { Session } from "@opencode-ai/schema/session"
import { SessionPending } from "@opencode-ai/schema/session-pending"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Command } from "@opencode-ai/schema/command"
import { Connection } from "@opencode-ai/schema/connection"
import { Credential } from "@opencode-ai/schema/credential"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Integration } from "@opencode-ai/schema/integration"
import { LLM } from "@opencode-ai/schema/llm"
import { Permission } from "@opencode-ai/schema/permission"
import { Pty } from "@opencode-ai/schema/pty"
import { Reference } from "@opencode-ai/schema/reference"
import { Skill } from "@opencode-ai/schema/skill"
import { AbsolutePath, DateTimeUtcFromMillis, optional, statics } from "@opencode-ai/schema/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"

test("Core reuses the canonical shared schemas", async () => {
  const [
    coreCommand,
    coreConnection,
    coreCredential,
    coreFileSystem,
    coreIntegration,
    coreLocation,
    coreLLM,
    corePermission,
    corePermissionV1,
    coreProjectCopy,
    corePty,
    coreProject,
    coreReference,
    coreSessionPending,
    coreSessionMessage,
    coreSkill,
    coreV2Schema,
    coreSchema,
    coreWorkspace,
  ] = await Promise.all([
    import("@opencode-ai/core/command"),
    import("@opencode-ai/core/integration/connection"),
    import("@opencode-ai/core/credential"),
    import("@opencode-ai/core/filesystem"),
    import("@opencode-ai/core/integration"),
    import("@opencode-ai/core/location"),
    import("@opencode-ai/llm"),
    import("@opencode-ai/core/permission"),
    import("@opencode-ai/core/v1/permission"),
    import("@opencode-ai/core/project/copy"),
    import("@opencode-ai/core/pty"),
    import("@opencode-ai/core/project/schema"),
    import("@opencode-ai/core/reference"),
    import("@opencode-ai/core/session/pending"),
    import("@opencode-ai/core/session/message"),
    import("@opencode-ai/core/skill"),
    import("@opencode-ai/core/v2-schema"),
    import("@opencode-ai/core/schema"),
    import("@opencode-ai/core/workspace"),
  ])

  const schemas = [
    [AgentV2.ID, Agent.ID],
    [AgentV2.Name, Agent.Name],
    [AgentV2.Color, Agent.Color],
    [AgentV2.Info, Agent.Info],
    [coreCommand.Info, Command.Info],
    [coreConnection.CredentialInfo, Connection.CredentialInfo],
    [coreConnection.EnvInfo, Connection.EnvInfo],
    [coreConnection.Info, Connection.Info],
    [coreCredential.ID, Credential.ID],
    [coreCredential.OAuth, Credential.OAuth],
    [coreCredential.Key, Credential.Key],
    [coreCredential.Value, Credential.Value],
    [coreFileSystem.Entry, FileSystem.Entry],
    [coreFileSystem.Submatch, FileSystem.Submatch],
    [coreFileSystem.Match, FileSystem.Match],
    [coreIntegration.ID, Integration.ID],
    [coreIntegration.MethodID, Integration.MethodID],
    [coreIntegration.When, Integration.When],
    [coreIntegration.TextPrompt, Integration.TextPrompt],
    [coreIntegration.SelectPrompt, Integration.SelectPrompt],
    [coreIntegration.Prompt, Integration.Prompt],
    [coreIntegration.OAuthMethod, Integration.OAuthMethod],
    [coreIntegration.KeyMethod, Integration.KeyMethod],
    [coreIntegration.EnvMethod, Integration.EnvMethod],
    [coreIntegration.Method, Integration.Method],
    [coreIntegration.Inputs, Integration.Inputs],
    [coreIntegration.Ref, Integration.Ref],
    [coreLocation.Ref, Location.Ref],
    [coreLLM.ProviderMetadata, LLM.ProviderMetadata],
    [coreLLM.FinishReason, LLM.FinishReason],
    [coreLLM.ToolTextContent, LLM.ToolTextContent],
    [coreLLM.ToolFileContent, LLM.ToolFileContent],
    [coreLLM.ToolContent, LLM.ToolContent],
    [ModelV2.ID, Model.ID],
    [ModelV2.VariantID, Model.VariantID],
    [ModelV2.Ref, Model.Ref],
    [ModelV2.Family, Model.Family],
    [ModelV2.Capabilities, Model.Capabilities],
    [ModelV2.Cost, Model.Cost],
    [ModelV2.Info, Model.Info],
    [ProviderV2.ID, Provider.ID],
    [ProviderV2.Request, Provider.Request],
    [ProviderV2.Info, Provider.Info],
    [corePermission.Effect, Permission.Effect],
    [corePermission.Rule, Permission.Rule],
    [corePermission.Ruleset, Permission.Ruleset],
    [corePermissionV1.Event, PermissionV1.Event],
    [coreProjectCopy.Event, ProjectDirectories.Event],
    [corePty.Info, Pty.Info],
    [corePty.Event, Pty.Event],
    [coreProject.ID, Project.ID],
    [coreProject.Current, Project.Current],
    [coreProject.Directory, Project.Directory],
    [coreProject.DirectoriesInput, Project.DirectoriesInput],
    [coreProject.Directories, Project.Directories],
    [coreReference.LocalSource, Reference.LocalSource],
    [coreReference.GitSource, Reference.GitSource],
    [coreReference.Source, Reference.Source],
    [SessionV2.ID, Session.ID],
    [SessionV2.Info, Session.Info],
    [SessionV2.ListAnchor, Session.ListAnchor],
    [coreSessionPending.Delivery, SessionPending.Delivery],
    [coreSessionPending.Message, SessionPending.Message],
    [coreSessionPending.User, SessionPending.User],
    [coreSessionPending.Synthetic, SessionPending.Synthetic],
    [coreSessionMessage.ID, SessionMessage.ID],
    [coreSessionMessage.AssistantRetry, SessionMessage.AssistantRetry],
    [coreSessionMessage.AgentSelected, SessionMessage.AgentSelected],
    [coreSessionMessage.ModelSelected, SessionMessage.ModelSelected],
    [coreSessionMessage.User, SessionMessage.User],
    [coreSessionMessage.Synthetic, SessionMessage.Synthetic],
    [coreSessionMessage.System, SessionMessage.System],
    [coreSessionMessage.Shell, SessionMessage.Shell],
    [coreSessionMessage.ToolStateStreaming, SessionMessage.ToolStateStreaming],
    [coreSessionMessage.ToolStateRunning, SessionMessage.ToolStateRunning],
    [coreSessionMessage.ToolStateCompleted, SessionMessage.ToolStateCompleted],
    [coreSessionMessage.ToolStateError, SessionMessage.ToolStateError],
    [coreSessionMessage.ToolState, SessionMessage.ToolState],
    [coreSessionMessage.AssistantTool, SessionMessage.AssistantTool],
    [coreSessionMessage.AssistantText, SessionMessage.AssistantText],
    [coreSessionMessage.AssistantReasoning, SessionMessage.AssistantReasoning],
    [coreSessionMessage.AssistantContent, SessionMessage.AssistantContent],
    [coreSessionMessage.Assistant, SessionMessage.Assistant],
    [coreSessionMessage.Compaction, SessionMessage.Compaction],
    [coreSessionMessage.Info, SessionMessage.Info],
    [coreSkill.DirectorySource, Skill.DirectorySource],
    [coreSkill.UrlSource, Skill.UrlSource],
    [coreSkill.EmbeddedSource, Skill.EmbeddedSource],
    [coreSkill.Source, Skill.Source],
    [coreSkill.Info, Skill.Info],
    [coreV2Schema.DateTimeUtcFromMillis, DateTimeUtcFromMillis],
    [coreSchema.optional, optional],
    [coreSchema.statics, statics],
    [coreWorkspace.ID, Workspace.ID],
  ]
  for (const [core, shared] of schemas) expect(core).toBe(shared)

  expect(Agent.Info.empty(Agent.ID.make("test"))).toEqual(AgentV2.Info.empty(AgentV2.ID.make("test")))
  expect(Model.Info.empty(Provider.ID.make("test"), Model.ID.make("model"))).toEqual(
    ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("model")),
  )
  expect(Provider.Info.empty(Provider.ID.make("test"))).toEqual(ProviderV2.Info.empty(ProviderV2.ID.make("test")))
  expect(Skill.Source.key(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make("/tmp") }))).toBe(
    "directory:/tmp",
  )
})

test("shared record schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
  expect(Prompt.equivalence(Prompt.make({ text: "hello" }), decoded)).toBe(true)
  expect(Prompt.fromUserMessage({ text: "hello" })).toEqual(made)
  expect(Workspace.ID.ascending("")).toStartWith("wrk_")
})

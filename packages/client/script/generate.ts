import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@Mackery6969/httpapi-codegen"
import {
  ClientApi,
  clientNamespace,
  effectOmitEndpoints,
  groupNames,
  promiseOmitEndpoints,
} from "@Mackery6969/protocol/client"
import { Agent } from "@Mackery6969/schema/agent"
import { Artifact } from "@Mackery6969/schema/artifact"
import { Command } from "@Mackery6969/schema/command"
import { Config } from "@Mackery6969/schema/config"
import { Credential } from "@Mackery6969/schema/credential"
import { Event } from "@Mackery6969/schema/event"
import { EventLog } from "@Mackery6969/schema/event-log"
import { FileDiff } from "@Mackery6969/schema/file-diff"
import { FileSystem } from "@Mackery6969/schema/filesystem"
import { Form } from "@Mackery6969/schema/form"
import { Generate } from "@Mackery6969/schema/generate"
import { Instruction } from "@Mackery6969/schema/instruction"
import { InstructionEntry } from "@Mackery6969/schema/instruction-entry"
import { Integration } from "@Mackery6969/schema/integration"
import { Job } from "@Mackery6969/schema/job"
import { Location } from "@Mackery6969/schema/location"
import { Mcp } from "@Mackery6969/schema/mcp"
import { Model } from "@Mackery6969/schema/model"
import { Money } from "@Mackery6969/schema/money"
import { Permission } from "@Mackery6969/schema/permission"
import { PermissionSaved } from "@Mackery6969/schema/permission-saved"
import { Plugin } from "@Mackery6969/schema/plugin"
import { Project } from "@Mackery6969/schema/project"
import { Worktree } from "@Mackery6969/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@Mackery6969/schema/prompt"
import { PromptInput } from "@Mackery6969/schema/prompt-input"
import { Provider } from "@Mackery6969/schema/provider"
import { Pty } from "@Mackery6969/schema/pty"
import { PtyTicket } from "@Mackery6969/schema/pty-ticket"
import { Question } from "@Mackery6969/schema/question"
import { Reference } from "@Mackery6969/schema/reference"
import { AbsolutePath, RelativePath } from "@Mackery6969/schema/schema"
import { Schedule } from "@Mackery6969/schema/schedule"
import { Session } from "@Mackery6969/schema/session"
import { SessionMessage } from "@Mackery6969/schema/session-message"
import { SessionInbox } from "@Mackery6969/schema/session-inbox"
import { Shell } from "@Mackery6969/schema/shell"
import { Skill } from "@Mackery6969/schema/skill"
import { Snapshot } from "@Mackery6969/schema/snapshot"
import { UsageLimits } from "@Mackery6969/schema/usage-limits"
import { Vcs } from "@Mackery6969/schema/vcs"
import { WebSearch } from "@Mackery6969/schema/websearch"
import { Workspace } from "@Mackery6969/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: promiseOmitEndpoints,
  namespace: clientNamespace,
  aliases: true,
})
const effectContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: effectOmitEndpoints,
  namespace: clientNamespace,
  aliases: true,
})
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@Mackery6969/schema/agent", Agent),
  ...namespaceTypes("Artifact", "@Mackery6969/schema/artifact", Artifact),
  ...namespaceTypes("Command", "@Mackery6969/schema/command", Command),
  ...namespaceTypes("Config", "@Mackery6969/schema/config", Config),
  ...namespaceTypes("Credential", "@Mackery6969/schema/credential", Credential),
  ...namespaceTypes("Event", "@Mackery6969/schema/event", Event),
  ...namespaceTypes("EventLog", "@Mackery6969/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@Mackery6969/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@Mackery6969/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@Mackery6969/schema/form", Form),
  ...namespaceTypes("Generate", "@Mackery6969/schema/generate", Generate),
  ...namespaceTypes("Instruction", "@Mackery6969/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@Mackery6969/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@Mackery6969/schema/integration", Integration),
  ...namespaceTypes("Job", "@Mackery6969/schema/job", Job),
  typeReference("Location.PublicRef", "@Mackery6969/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@Mackery6969/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@Mackery6969/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@Mackery6969/schema/model", Model),
  ...namespaceTypes("Money", "@Mackery6969/schema/money", Money),
  ...namespaceTypes("Permission", "@Mackery6969/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@Mackery6969/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@Mackery6969/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@Mackery6969/schema/project", Project),
  ...namespaceTypes("Worktree", "@Mackery6969/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@Mackery6969/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@Mackery6969/schema/provider", Provider),
  ...namespaceTypes("Pty", "@Mackery6969/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@Mackery6969/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@Mackery6969/schema/question", Question),
  ...namespaceTypes("Reference", "@Mackery6969/schema/reference", Reference),
  ...namespaceTypes("Schedule", "@Mackery6969/schema/schedule", Schedule),
  ...namespaceTypes("Session", "@Mackery6969/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@Mackery6969/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@Mackery6969/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@Mackery6969/schema/shell", Shell),
  ...namespaceTypes("Skill", "@Mackery6969/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@Mackery6969/schema/snapshot", Snapshot),
  ...namespaceTypes("UsageLimits", "@Mackery6969/schema/usage-limits", UsageLimits),
  ...namespaceTypes("Vcs", "@Mackery6969/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@Mackery6969/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@Mackery6969/schema/workspace", Workspace),
  typeReference("Prompt", "@Mackery6969/schema/prompt", Prompt),
  typeReference("PromptMention", "@Mackery6969/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@Mackery6969/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@Mackery6969/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@Mackery6969/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@Mackery6969/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "OpenCodeEvent",
              import: 'import type { OpenCodeEvent } from "@Mackery6969/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}

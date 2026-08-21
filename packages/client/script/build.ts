import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@opencode-ai/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@opencode-ai/protocol/client"
import { Agent } from "@opencode-ai/schema/agent"
import { Capability } from "@opencode-ai/schema/capability"
import { Command } from "@opencode-ai/schema/command"
import { Config } from "@opencode-ai/schema/config"
import { Credential } from "@opencode-ai/schema/credential"
import { Event } from "@opencode-ai/schema/event"
import { EventLog } from "@opencode-ai/schema/event-log"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Form } from "@opencode-ai/schema/form"
import { InstructionEntry } from "@opencode-ai/schema/instruction-entry"
import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Mcp } from "@opencode-ai/schema/mcp"
import { Model } from "@opencode-ai/schema/model"
import { Permission } from "@opencode-ai/schema/permission"
import { PermissionSaved } from "@opencode-ai/schema/permission-saved"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Project } from "@opencode-ai/schema/project"
import { Worktree } from "@opencode-ai/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@opencode-ai/schema/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Provider } from "@opencode-ai/schema/provider"
import { Pty } from "@opencode-ai/schema/pty"
import { PtyTicket } from "@opencode-ai/schema/pty-ticket"
import { Question } from "@opencode-ai/schema/question"
import { Reference } from "@opencode-ai/schema/reference"
import { AbsolutePath, PositiveInt, RelativePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { Shell } from "@opencode-ai/schema/shell"
import { Skill } from "@opencode-ai/schema/skill"
import { Vcs } from "@opencode-ai/schema/vcs"
import { WebSearch } from "@opencode-ai/schema/websearch"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@opencode-ai/schema/agent", Agent),
  ...namespaceTypes("Capability", "@opencode-ai/schema/capability", Capability),
  ...namespaceTypes("Command", "@opencode-ai/schema/command", Command),
  ...namespaceTypes("Config", "@opencode-ai/schema/config", Config),
  ...namespaceTypes("Credential", "@opencode-ai/schema/credential", Credential),
  ...namespaceTypes("Event", "@opencode-ai/schema/event", Event),
  ...namespaceTypes("EventLog", "@opencode-ai/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@opencode-ai/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@opencode-ai/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@opencode-ai/schema/form", Form),
  ...namespaceTypes("InstructionEntry", "@opencode-ai/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@opencode-ai/schema/integration", Integration),
  ...namespaceTypes("Location", "@opencode-ai/schema/location", Location),
  ...namespaceTypes("Mcp", "@opencode-ai/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@opencode-ai/schema/model", Model),
  ...namespaceTypes("Permission", "@opencode-ai/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@opencode-ai/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@opencode-ai/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@opencode-ai/schema/project", Project),
  ...namespaceTypes("Worktree", "@opencode-ai/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@opencode-ai/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@opencode-ai/schema/provider", Provider),
  ...namespaceTypes("Pty", "@opencode-ai/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@opencode-ai/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@opencode-ai/schema/question", Question),
  ...namespaceTypes("Reference", "@opencode-ai/schema/reference", Reference),
  ...namespaceTypes("Session", "@opencode-ai/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@opencode-ai/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@opencode-ai/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@opencode-ai/schema/shell", Shell),
  ...namespaceTypes("Skill", "@opencode-ai/schema/skill", Skill),
  ...namespaceTypes("Vcs", "@opencode-ai/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@opencode-ai/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@opencode-ai/schema/workspace", Workspace),
  typeReference("Prompt", "@opencode-ai/schema/prompt", Prompt),
  typeReference("PromptMention", "@opencode-ai/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@opencode-ai/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@opencode-ai/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@opencode-ai/schema/schema", AbsolutePath),
  typeReference("PositiveInt", "@opencode-ai/schema/schema", PositiveInt),
  typeReference("RelativePath", "@opencode-ai/schema/schema", RelativePath),
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
              import: 'import type { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"',
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

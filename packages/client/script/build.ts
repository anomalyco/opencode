import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@opencode/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@opencode/protocol/client"
import { Agent } from "@opencode/schema/agent"
import { Command } from "@opencode/schema/command"
import { Config } from "@opencode/schema/config"
import { Credential } from "@opencode/schema/credential"
import { Event } from "@opencode/schema/event"
import { EventLog } from "@opencode/schema/event-log"
import { FileDiff } from "@opencode/schema/file-diff"
import { FileSystem } from "@opencode/schema/filesystem"
import { Form } from "@opencode/schema/form"
import { InstructionEntry } from "@opencode/schema/instruction-entry"
import { Integration } from "@opencode/schema/integration"
import { Location } from "@opencode/schema/location"
import { Mcp } from "@opencode/schema/mcp"
import { Model } from "@opencode/schema/model"
import { Permission } from "@opencode/schema/permission"
import { PermissionSaved } from "@opencode/schema/permission-saved"
import { Plugin } from "@opencode/schema/plugin"
import { Project } from "@opencode/schema/project"
import { Worktree } from "@opencode/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@opencode/schema/prompt"
import { PromptInput } from "@opencode/schema/prompt-input"
import { Provider } from "@opencode/schema/provider"
import { Pty } from "@opencode/schema/pty"
import { PtyTicket } from "@opencode/schema/pty-ticket"
import { Question } from "@opencode/schema/question"
import { Reference } from "@opencode/schema/reference"
import { AbsolutePath, PositiveInt, RelativePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { Shell } from "@opencode/schema/shell"
import { Skill } from "@opencode/schema/skill"
import { Vcs } from "@opencode/schema/vcs"
import { WebSearch } from "@opencode/schema/websearch"
import { Workspace } from "@opencode/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@opencode/schema/agent", Agent),
  ...namespaceTypes("Command", "@opencode/schema/command", Command),
  ...namespaceTypes("Config", "@opencode/schema/config", Config),
  ...namespaceTypes("Credential", "@opencode/schema/credential", Credential),
  ...namespaceTypes("Event", "@opencode/schema/event", Event),
  ...namespaceTypes("EventLog", "@opencode/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@opencode/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@opencode/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@opencode/schema/form", Form),
  ...namespaceTypes("InstructionEntry", "@opencode/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@opencode/schema/integration", Integration),
  ...namespaceTypes("Location", "@opencode/schema/location", Location),
  ...namespaceTypes("Mcp", "@opencode/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@opencode/schema/model", Model),
  ...namespaceTypes("Permission", "@opencode/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@opencode/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@opencode/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@opencode/schema/project", Project),
  ...namespaceTypes("Worktree", "@opencode/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@opencode/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@opencode/schema/provider", Provider),
  ...namespaceTypes("Pty", "@opencode/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@opencode/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@opencode/schema/question", Question),
  ...namespaceTypes("Reference", "@opencode/schema/reference", Reference),
  ...namespaceTypes("Session", "@opencode/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@opencode/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@opencode/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@opencode/schema/shell", Shell),
  ...namespaceTypes("Skill", "@opencode/schema/skill", Skill),
  ...namespaceTypes("Vcs", "@opencode/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@opencode/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@opencode/schema/workspace", Workspace),
  typeReference("Prompt", "@opencode/schema/prompt", Prompt),
  typeReference("PromptMention", "@opencode/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@opencode/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@opencode/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@opencode/schema/schema", AbsolutePath),
  typeReference("PositiveInt", "@opencode/schema/schema", PositiveInt),
  typeReference("RelativePath", "@opencode/schema/schema", RelativePath),
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
              import: 'import type { OpenCodeEvent } from "@opencode/protocol/groups/event"',
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

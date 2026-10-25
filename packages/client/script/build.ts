import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitPromise, write } from "@bolt-ai/httpapi-codegen"
import { ClientApi, endpointNames, groupNames, omitEndpoints } from "../src/contract"
import { Effect } from "effect"
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
  ...namespaceTypes("Instruction", "@opencode/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@opencode/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@opencode/schema/integration", Integration),
  typeReference("Location.PublicRef", "@opencode/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@opencode/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@opencode/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@opencode/schema/model", Model),
  ...namespaceTypes("Money", "@opencode/schema/money", Money),
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
  ...namespaceTypes("Snapshot", "@opencode/schema/snapshot", Snapshot),
  ...namespaceTypes("UsageLimits", "@opencode/schema/usage-limits", UsageLimits),
  ...namespaceTypes("Vcs", "@opencode/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@opencode/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@opencode/schema/workspace", Workspace),
  typeReference("Prompt", "@opencode/schema/prompt", Prompt),
  typeReference("PromptMention", "@opencode/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@opencode/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@opencode/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@opencode/schema/schema", AbsolutePath),
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
            "events.subscribe": {
              name: "BoltEventEncoded",
              import: 'import type { BoltEventEncoded } from "@bolt-ai/protocol/groups/event"',
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

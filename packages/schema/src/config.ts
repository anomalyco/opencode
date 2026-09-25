export * as Config from "./config.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Permission } from "./permission.js"
import { AbsolutePath, optional } from "./schema.js"
import { ConfigAgent } from "./config/agent.js"
import { ConfigMedia } from "./config/media.js"
import { ConfigCompaction } from "./config/compaction.js"
import { ConfigCommand } from "./config/command.js"
import { ConfigExperimental } from "./config/experimental.js"
import { ConfigFormatter } from "./config/formatter.js"
import { ConfigLSP } from "./config/lsp.js"
import { ConfigMCP } from "./config/mcp.js"
import { ConfigModel } from "./config/model.js"
import { ConfigPlugin } from "./config/plugin.js"
import { ConfigProvider } from "./config/provider.js"
import { ConfigReference } from "./config/reference.js"
import { ConfigWebSearch } from "./config/websearch.js"
import { ConfigToolOutput } from "./config/tool-output.js"
import { ConfigWatcher } from "./config/watcher.js"
import { ConfigWarming } from "./config/warming.js"
import { ConfigWorktree } from "./config/worktree.js"

export class Info extends Schema.Class<Info>("Config.Info")({
  $schema: optional(
    Schema.String.annotate({
      description: "JSON schema reference for configuration validation",
    }),
  ),
  shell: Schema.String.annotate({
    description: "Default shell to use for terminal and shell tool execution",
  }).pipe(optional),
  model: ConfigModel.Selection.annotate({
    description: "Default model to use when no session or agent model is selected",
  }).pipe(optional),
  default_agent: Schema.String.annotate({
    description: "Default primary agent to use when no session agent is selected",
  }).pipe(optional),
  update: Schema.Literals(["disable", "notify", "auto"])
    .annotate({
      description: "Disable updates, notify when one is available, or install updates automatically",
    })
    .pipe(optional),
  share: Schema.Literals(["manual", "auto", "disabled"])
    .annotate({
      description: "Control whether sessions may be shared manually, automatically, or not at all",
    })
    .pipe(optional),
  enterprise: Schema.Struct({
    url: Schema.String.pipe(optional),
  })
    .annotate({
      description: "Enterprise sharing service configuration",
    })
    .pipe(optional),
  username: Schema.String.annotate({
    description: "Username displayed in conversations and used for telemetry identity",
  }).pipe(optional),
  permissions: Permission.Ruleset.annotate({
    description: "Ordered tool permission rules applied to agent tool use",
  }).pipe(optional),
  agents: Schema.Record(Schema.String, ConfigAgent.Info)
    .annotate({
      description: "Named built-in agent overrides and custom agent definitions",
    })
    .pipe(optional),
  snapshots: Schema.Boolean.annotate({
    description: "Enable snapshots used for undo and revert behavior",
  }).pipe(optional),
  watcher: ConfigWatcher.Info.annotate({
    description: "Filesystem watcher configuration",
  }).pipe(optional),
  formatter: ConfigFormatter.Info.annotate({
    description: "Enable built-in formatters or configure formatter overrides",
  }).pipe(optional),
  lsp: ConfigLSP.Info.annotate({
    description: "Enable built-in language servers or configure server overrides",
  }).pipe(optional),
  media: ConfigMedia.Info.annotate({
    description: "Media processing configuration",
  }).pipe(optional),
  tool_output: ConfigToolOutput.Info.annotate({
    description: "Tool output truncation thresholds",
  }).pipe(optional),
  mcp: ConfigMCP.Info.annotate({
    description: "MCP server configuration",
  }).pipe(optional),
  compaction: ConfigCompaction.Info.annotate({
    description: "Conversation compaction behavior",
  }).pipe(optional),
  skills: Schema.String.pipe(Schema.Array)
    .annotate({
      description: "Additional paths or URLs to discover skills from",
    })
    .pipe(optional),
  commands: Schema.Record(Schema.String, ConfigCommand.Info)
    .annotate({
      description: "Named slash command definitions",
    })
    .pipe(optional),
  instructions: Schema.String.pipe(Schema.Array)
    .annotate({
      description: "Additional paths or URLs supplying ambient instructions",
    })
    .pipe(optional),
  references: ConfigReference.Info.annotate({
    description: "Named local directories or Git repositories available as external context",
  }).pipe(optional),
  websearch: ConfigWebSearch.Selection.annotate({
    description: "Web search provider selection",
  }).pipe(optional),
  plugins: ConfigPlugin.Plugins.annotate({
    description: "Ordered plugin enablement directives and external package declarations",
  }).pipe(optional),
  worktree: ConfigWorktree.Info.annotate({
    description: "Directory defaults for local worktree creation",
  }).pipe(optional),
  warming: ConfigWarming.Warming.annotate({
    description: "Keep recently active sessions warm with transient model requests (default: false)",
  }).pipe(optional),
  providers: Schema.Record(Schema.String, ConfigProvider.Info).pipe(optional),
  experimental: ConfigExperimental.Info.pipe(optional),
}) {}

export const Patch = Schema.Struct({
  shell: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Config.Patch" })
export interface Patch extends Schema.Schema.Type<typeof Patch> {}

export class Document extends Schema.Class<Document>("Config.Document")({
  type: Schema.Literal("document"),
  path: AbsolutePath.pipe(optional),
  info: Info,
}) {}

export class Directory extends Schema.Class<Directory>("Config.Directory")({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}) {}

export const Entry = Schema.Union([Document, Directory]).annotate({
  identifier: "Config.Entry",
})
export type Entry = typeof Entry.Type

const Updated = ephemeral({
  type: "config.updated",
  schema: {},
})

export const Event = { Updated, Definitions: inventory(Updated) }

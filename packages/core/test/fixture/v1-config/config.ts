export * as ConfigV1 from "./config"

import { Schema } from "effect"
import { ConfigReference } from "@opencode/schema/config/reference"
import { NonNegativeInt, PositiveInt } from "@opencode/core/schema"
import { ConfigAgentV1 } from "@opencode/core/v1/config/agent"
import { ConfigAttachmentV1 } from "./attachment"
import { ConfigCommandV1 } from "./command"
import { ConfigCompatV1 } from "./compat"
import { ConfigFormatterV1 } from "./formatter"
import { ConfigLayoutV1 } from "./layout"
import { ConfigLSPV1 } from "./lsp"
import { ConfigMCPV1 } from "@opencode/core/v1/config/mcp"
import { ConfigPermissionV1 } from "@opencode/core/v1/config/permission"
import { ConfigPluginV1 } from "@opencode/core/v1/config/plugin"
import { ConfigProviderV1 } from "@opencode/core/v1/config/provider"
import { ConfigServerV1 } from "./server"
import { ConfigSkillsV1 } from "./skills"

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.optional(Schema.String).annotate({ description: "Default shell to use for terminal and bash tool" }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServerV1.Server).annotate({
    description: "Server configuration for opencode serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommandV1.Info)).annotate({
    description: "Command configuration, see https://bolt.ai/docs/commands",
  }),
  skills: Schema.optional(ConfigSkillsV1.Info).annotate({ description: "Additional skill folder paths" }),
  references: Schema.optional(ConfigReference.Info).annotate({
    description: "Named git or local directory references",
  }),
  reference: Schema.optional(ConfigReference.Info).annotate({
    description: "@deprecated Use 'references' field instead. Named git or local directory references",
  }),
  watcher: Schema.optional(Schema.Struct({ ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))) })),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPluginV1.Spec))),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(Schema.String).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  profile: Schema.optional(Schema.Record(Schema.String, Schema.Json)).annotate({
    description:
      "Named configuration profiles selected with --profile or BOLT_PROFILE. Each profile is a partial config object (model, provider, mcp, etc.) merged over all file-based config when active",
  }),
  alias: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description:
      'Command aliases expanded before argument parsing, e.g. { "deploy-check": "run --agent reviewer \'audit the deploy diff\'" }',
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  subagent_depth: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1, which prevents subagents from launching subagents.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({ build: Schema.optional(ConfigAgentV1.Info), plan: Schema.optional(ConfigAgentV1.Info) }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        plan: Schema.optional(ConfigAgentV1.Info),
        build: Schema.optional(ConfigAgentV1.Info),
        general: Schema.optional(ConfigAgentV1.Info),
        explore: Schema.optional(ConfigAgentV1.Info),
        title: Schema.optional(ConfigAgentV1.Info),
        summary: Schema.optional(ConfigAgentV1.Info),
        compaction: Schema.optional(ConfigAgentV1.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "Agent configuration, see https://bolt.ai/docs/agents" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProviderV1.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([ConfigMCPV1.Info, Schema.Struct({ enabled: Schema.Boolean })])),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  formatter: Schema.optional(ConfigFormatterV1.Info).annotate({
    description:
      "Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  lsp: Schema.optional(ConfigLSPV1.Info).annotate({
    description:
      "Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  compat: Schema.optional(Schema.Union([Schema.Boolean, ConfigCompatV1.Info])).annotate({
    description:
      "Import configuration written for other coding agents. A boolean enables or disables all imports; an object toggles rules, mcp, commands, and agents individually. Rules, commands, and agents default to true; mcp defaults to false.",
  }),
  layout: Schema.optional(ConfigLayoutV1.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(ConfigPermissionV1.Info),
  protected_paths: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      'Worktree-relative path patterns the agent may never modify, e.g. [".env", "secrets/*"]. Supports * and ? wildcards; a pattern also protects everything beneath a matching directory. Matching writes and edits fail before any permission prompt.',
  }),
  redact: Schema.optional(Schema.Boolean).annotate({
    description:
      "Redact well-known secret formats (API keys, tokens, private keys) from prompts before they are sent to models. Log output is always redacted. Defaults to true.",
  }),
  guardrail: Schema.optional(Schema.Boolean).annotate({
    description:
      "Screen risky shell commands with a guardrail agent before they run. Flagged commands are reviewed on the small model and blocked when the guardrail vetoes them. Defaults to false.",
  }),
  approval: Schema.optional(Schema.Boolean).annotate({
    description:
      "Require a second agent's sign-off before destructive shell commands run. The reviewer runs on the small model and rejects when it cannot produce a verdict. Defaults to false.",
  }),
  tool_budget: Schema.optional(Schema.Record(Schema.String, PositiveInt)).annotate({
    description:
      'Maximum number of times each tool may run per session, e.g. { "webfetch": 10 }. Calls beyond the budget fail without executing.',
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  attachment: Schema.optional(ConfigAttachmentV1.Info).annotate({
    description: "Attachment processing configuration, including image size limits and resizing behavior",
  }),
  enterprise: Schema.optional(
    Schema.Struct({ url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }) }),
  ),
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      pinned: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description:
          "Files and facts that must never be compacted away. Entries matching a file the conversation touched are pinned as files; other entries are preserved verbatim as facts.",
      }),
      preemptive: Schema.optional(Schema.Boolean).annotate({
        description:
          "Compact in the background once context passes 80% of the usable window, after a response finishes instead of mid-prompt when it overflows (default: false)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: Schema.optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      subagent_depth: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum subagent nesting depth. Defaults to 1.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      diff_context: Schema.optional(Schema.Boolean).annotate({
        description:
          "Attach only the changed hunks (diff against HEAD) when a locally modified file is attached without an explicit range, instead of the whole file (default: false)",
      }),
      symbol_graph: Schema.optional(Schema.Boolean).annotate({
        description:
          "Append a cross-file symbol graph (which files reference the edited file's symbols) to edit tool output (default: false)",
      }),
      context_replay: Schema.optional(Schema.Boolean).annotate({
        description:
          "Record the exact system prompt, messages, and tools sent to the model for each turn so they can be inspected with bolt debug context (default: false)",
      }),
      policies: Schema.optional(Schema.mutable(Schema.Array(ConfigExperimental.Policy))).annotate({
        description: "Policy statements applied to supported resources, such as provider access",
      }),
    }),
  ),
}).annotate({ identifier: "Config" })

import z from "zod"
import { ModelsDev } from "../provider/models"
import { Log } from "../util/log"
import { LSPServer } from "../lsp/server"

export const McpLocal = z
  .object({
    type: z.literal("local").describe("Type of MCP server connection"),
    command: z.string().array().describe("Command and arguments to run the MCP server"),
    environment: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables to set when running the MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified."),
  })
  .strict()
  .meta({
    ref: "McpLocalConfig",
  })

export const McpOAuth = z
  .object({
    clientId: z
      .string()
      .optional()
      .describe("OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted."),
    clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
    scope: z.string().optional().describe("OAuth scopes to request during authorization"),
  })
  .strict()
  .meta({
    ref: "McpOAuthConfig",
  })
export type McpOAuth = z.infer<typeof McpOAuth>

export const McpRemote = z
  .object({
    type: z.literal("remote").describe("Type of MCP server connection"),
    url: z.string().describe("URL of the remote MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
    oauth: z
      .union([McpOAuth, z.literal(false)])
      .optional()
      .describe("OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection."),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified."),
  })
  .strict()
  .meta({
    ref: "McpRemoteConfig",
  })

export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
export type Mcp = z.infer<typeof Mcp>

export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({
  ref: "PermissionActionConfig",
})
export type PermissionAction = z.infer<typeof PermissionAction>

export const PermissionObject = z.record(z.string(), PermissionAction).meta({
  ref: "PermissionObjectConfig",
})
export type PermissionObject = z.infer<typeof PermissionObject>

export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({
  ref: "PermissionRuleConfig",
})
export type PermissionRule = z.infer<typeof PermissionRule>

// Capture original key order before zod reorders, then rebuild in original order
const permissionPreprocess = (val: unknown) => {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return { __originalKeys: Object.keys(val), ...val }
  }
  return val
}

const permissionTransform = (x: unknown): Record<string, PermissionRule> => {
  if (typeof x === "string") return { "*": x as PermissionAction }
  const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
  const { __originalKeys, ...rest } = obj
  if (!__originalKeys) return rest as Record<string, PermissionRule>
  const result: Record<string, PermissionRule> = {}
  for (const key of __originalKeys) {
    if (key in rest) result[key] = rest[key] as PermissionRule
  }
  return result
}

export const Permission = z
  .preprocess(
    permissionPreprocess,
    z
      .object({
        __originalKeys: z.string().array().optional(),
        read: PermissionRule.optional(),
        edit: PermissionRule.optional(),
        glob: PermissionRule.optional(),
        grep: PermissionRule.optional(),
        list: PermissionRule.optional(),
        bash: PermissionRule.optional(),
        task: PermissionRule.optional(),
        external_directory: PermissionRule.optional(),
        todowrite: PermissionAction.optional(),
        todoread: PermissionAction.optional(),
        question: PermissionAction.optional(),
        webfetch: PermissionAction.optional(),
        websearch: PermissionAction.optional(),
        codesearch: PermissionAction.optional(),
        lsp: PermissionRule.optional(),
        doom_loop: PermissionAction.optional(),
        skill: PermissionRule.optional(),
      })
      .catchall(PermissionRule)
      .or(PermissionAction),
  )
  .transform(permissionTransform)
  .meta({
    ref: "PermissionConfig",
  })
export type Permission = z.infer<typeof Permission>

export const Command = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  subtask: z.boolean().optional(),
})
export type Command = z.infer<typeof Command>

export const Skills = z.object({
  paths: z.array(z.string()).optional().describe("Additional paths to skill folders"),
})
export type Skills = z.infer<typeof Skills>

export const Agent = z
  .object({
    model: z.string().optional(),
    variant: z
      .string()
      .optional()
      .describe("Default model variant for this agent (applies only when using the agent's configured model)."),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    prompt: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
    disable: z.boolean().optional(),
    description: z.string().optional().describe("Description of when to use the agent"),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
    hidden: z
      .boolean()
      .optional()
      .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
    options: z.record(z.string(), z.any()).optional(),
    color: z
      .union([
        z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
        z.enum(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
      ])
      .optional()
      .describe("Hex color code (e.g., #FF5733) or theme color (e.g., primary)"),
    steps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of agentic iterations before forcing text-only response"),
    maxSteps: z.number().int().positive().optional().describe("@deprecated Use 'steps' field instead."),
    permission: Permission.optional(),
  })
  .catchall(z.any())
  .transform((agent, ctx) => {
    const knownKeys = new Set([
      "name",
      "model",
      "variant",
      "prompt",
      "description",
      "temperature",
      "top_p",
      "mode",
      "hidden",
      "color",
      "steps",
      "maxSteps",
      "options",
      "permission",
      "disable",
      "tools",
    ])

    // Extract unknown properties into options
    const options: Record<string, unknown> = { ...agent.options }
    for (const [key, value] of Object.entries(agent)) {
      if (!knownKeys.has(key)) options[key] = value
    }

    // Convert legacy tools config to permissions
    const permission: Permission = {}
    for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
      const action = enabled ? "allow" : "deny"
      // write, edit, patch, multiedit all map to edit permission
      if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
        permission.edit = action
      } else {
        permission[tool] = action
      }
    }
    Object.assign(permission, agent.permission)

    // Convert legacy maxSteps to steps
    const steps = agent.steps ?? agent.maxSteps

    return { ...agent, options, permission, steps } as typeof agent & {
      options?: Record<string, unknown>
      permission?: Permission
      steps?: number
    }
  })
  .meta({
    ref: "AgentConfig",
  })
export type Agent = z.infer<typeof Agent>

export const Keybinds = z
  .object({
    leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
    app_exit: z.string().optional().default("ctrl+c,ctrl+d,<leader>q").describe("Exit the application"),
    editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
    theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
    sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
    scrollbar_toggle: z.string().optional().default("none").describe("Toggle session scrollbar"),
    username_toggle: z.string().optional().default("none").describe("Toggle username visibility"),
    status_view: z.string().optional().default("<leader>s").describe("View status"),
    session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
    session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
    session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
    session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
    session_fork: z.string().optional().default("none").describe("Fork session from message"),
    session_rename: z.string().optional().default("ctrl+r").describe("Rename session"),
    session_delete: z.string().optional().default("ctrl+d").describe("Delete session"),
    stash_delete: z.string().optional().default("ctrl+d").describe("Delete stash entry"),
    model_provider_list: z.string().optional().default("ctrl+a").describe("Open provider list from model dialog"),
    model_favorite_toggle: z.string().optional().default("ctrl+f").describe("Toggle model favorite status"),
    session_share: z.string().optional().default("none").describe("Share current session"),
    session_unshare: z.string().optional().default("none").describe("Unshare current session"),
    session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
    session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
    messages_page_up: z.string().optional().default("pageup,ctrl+alt+b").describe("Scroll messages up by one page"),
    messages_page_down: z
      .string()
      .optional()
      .default("pagedown,ctrl+alt+f")
      .describe("Scroll messages down by one page"),
    messages_line_up: z.string().optional().default("ctrl+alt+y").describe("Scroll messages up by one line"),
    messages_line_down: z.string().optional().default("ctrl+alt+e").describe("Scroll messages down by one line"),
    messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
    messages_half_page_down: z.string().optional().default("ctrl+alt+d").describe("Scroll messages down by half page"),
    messages_first: z.string().optional().default("ctrl+g,home").describe("Navigate to first message"),
    messages_last: z.string().optional().default("ctrl+alt+g,end").describe("Navigate to last message"),
    messages_next: z.string().optional().default("none").describe("Navigate to next message"),
    messages_previous: z.string().optional().default("none").describe("Navigate to previous message"),
    messages_last_user: z.string().optional().default("none").describe("Navigate to last user message"),
    messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
    messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
    messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
    messages_toggle_conceal: z
      .string()
      .optional()
      .default("<leader>h")
      .describe("Toggle code block concealment in messages"),
    tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
    model_list: z.string().optional().default("<leader>m").describe("List available models"),
    model_cycle_recent: z.string().optional().default("f2").describe("Next recently used model"),
    model_cycle_recent_reverse: z.string().optional().default("shift+f2").describe("Previous recently used model"),
    model_cycle_favorite: z.string().optional().default("none").describe("Next favorite model"),
    model_cycle_favorite_reverse: z.string().optional().default("none").describe("Previous favorite model"),
    command_list: z.string().optional().default("ctrl+p").describe("List available commands"),
    agent_list: z.string().optional().default("<leader>a").describe("List agents"),
    agent_cycle: z.string().optional().default("tab").describe("Next agent"),
    agent_cycle_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
    variant_cycle: z.string().optional().default("ctrl+t").describe("Cycle model variants"),
    input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
    input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
    input_submit: z.string().optional().default("return").describe("Submit input"),
    input_newline: z
      .string()
      .optional()
      .default("shift+return,ctrl+return,alt+return,ctrl+j")
      .describe("Insert newline in input"),
    input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
    input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
    input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
    input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
    input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
    input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
    input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
    input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
    input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
    input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
    input_select_line_home: z.string().optional().default("ctrl+shift+a").describe("Select to start of line in input"),
    input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
    input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
    input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
    input_select_visual_line_home: z
      .string()
      .optional()
      .default("alt+shift+a")
      .describe("Select to start of visual line in input"),
    input_select_visual_line_end: z
      .string()
      .optional()
      .default("alt+shift+e")
      .describe("Select to end of visual line in input"),
    input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
    input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
    input_select_buffer_home: z
      .string()
      .optional()
      .default("shift+home")
      .describe("Select to start of buffer in input"),
    input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
    input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
    input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
    input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
    input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
    input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
    input_undo: z.string().optional().default("ctrl+-,super+z").describe("Undo in input"),
    input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
    input_word_forward: z
      .string()
      .optional()
      .default("alt+f,alt+right,ctrl+right")
      .describe("Move word forward in input"),
    input_word_backward: z
      .string()
      .optional()
      .default("alt+b,alt+left,ctrl+left")
      .describe("Move word backward in input"),
    input_select_word_forward: z
      .string()
      .optional()
      .default("alt+shift+f,alt+shift+right")
      .describe("Select word forward in input"),
    input_select_word_backward: z
      .string()
      .optional()
      .default("alt+shift+b,alt+shift+left")
      .describe("Select word backward in input"),
    input_delete_word_forward: z
      .string()
      .optional()
      .default("alt+d,alt+delete,ctrl+delete")
      .describe("Delete word forward in input"),
    input_delete_word_backward: z
      .string()
      .optional()
      .default("ctrl+w,ctrl+backspace,alt+backspace")
      .describe("Delete word backward in input"),
    history_previous: z.string().optional().default("up").describe("Previous history item"),
    history_next: z.string().optional().default("down").describe("Next history item"),
    session_child_cycle: z.string().optional().default("<leader>right").describe("Next child session"),
    session_child_cycle_reverse: z.string().optional().default("<leader>left").describe("Previous child session"),
    session_parent: z.string().optional().default("<leader>up").describe("Go to parent session"),
    terminal_suspend: z.string().optional().default("ctrl+z").describe("Suspend terminal"),
    terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
    tips_toggle: z.string().optional().default("<leader>h").describe("Toggle tips on home screen"),
    display_thinking: z.string().optional().default("none").describe("Toggle thinking blocks visibility"),
  })
  .strict()
  .meta({
    ref: "KeybindsConfig",
  })

export const TUI = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
})

export const Server = z
  .object({
    port: z.number().int().positive().optional().describe("Port to listen on"),
    hostname: z.string().optional().describe("Hostname to listen on"),
    mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
    mdnsDomain: z.string().optional().describe("Custom domain name for mDNS service (default: opencode.local)"),
    cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
  })
  .strict()
  .meta({
    ref: "ServerConfig",
  })

export const Layout = z.enum(["auto", "stretch"]).meta({
  ref: "LayoutConfig",
})
export type Layout = z.infer<typeof Layout>

export const Provider = ModelsDev.Provider.partial()
  .extend({
    whitelist: z.array(z.string()).optional(),
    blacklist: z.array(z.string()).optional(),
    models: z
      .record(
        z.string(),
        ModelsDev.Model.partial().extend({
          variants: z
            .record(
              z.string(),
              z
                .object({
                  disabled: z.boolean().optional().describe("Disable this variant for the model"),
                })
                .catchall(z.any()),
            )
            .optional()
            .describe("Variant-specific configuration"),
        }),
      )
      .optional(),
    options: z
      .object({
        apiKey: z.string().optional(),
        baseURL: z.string().optional(),
        enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
        setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
        timeout: z
          .union([
            z
              .number()
              .int()
              .positive()
              .describe(
                "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
              ),
            z.literal(false).describe("Disable timeout for this provider entirely."),
          ])
          .optional()
          .describe(
            "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
          ),
      })
      .catchall(z.any())
      .optional(),
  })
  .strict()
  .meta({
    ref: "ProviderConfig",
  })
export type Provider = z.infer<typeof Provider>

export const Info = z
  .object({
    $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
    theme: z.string().optional().describe("Theme name to use for the interface"),
    keybinds: Keybinds.optional().describe("Custom keybind configurations"),
    logLevel: Log.Level.optional().describe("Log level"),
    tui: TUI.optional().describe("TUI specific settings"),
    server: Server.optional().describe("Server configuration for opencode serve and web commands"),
    command: z
      .record(z.string(), Command)
      .optional()
      .describe("Command configuration, see https://opencode.ai/docs/commands"),
    skills: Skills.optional().describe("Additional skill folder paths"),
    watcher: z
      .object({
        ignore: z.array(z.string()).optional(),
      })
      .optional(),
    plugin: z.string().array().optional(),
    snapshot: z.boolean().optional(),
    share: z
      .enum(["manual", "auto", "disabled"])
      .optional()
      .describe(
        "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
      ),
    autoshare: z
      .boolean()
      .optional()
      .describe("@deprecated Use 'share' field instead. Share newly created sessions automatically"),
    autoupdate: z
      .union([z.boolean(), z.literal("notify")])
      .optional()
      .describe(
        "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
      ),
    disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
    enabled_providers: z
      .array(z.string())
      .optional()
      .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
    model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
    small_model: z
      .string()
      .describe("Small model to use for tasks like title generation in the format of provider/model")
      .optional(),
    default_agent: z
      .string()
      .optional()
      .describe(
        "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
      ),
    username: z.string().optional().describe("Custom username to display in conversations instead of system username"),
    mode: z
      .object({
        build: Agent.optional(),
        plan: Agent.optional(),
      })
      .catchall(Agent)
      .optional()
      .describe("@deprecated Use `agent` field instead."),
    agent: z
      .object({
        // primary
        plan: Agent.optional(),
        build: Agent.optional(),
        // subagent
        general: Agent.optional(),
        explore: Agent.optional(),
        // specialized
        title: Agent.optional(),
        summary: Agent.optional(),
        compaction: Agent.optional(),
      })
      .catchall(Agent)
      .optional()
      .describe("Agent configuration, see https://opencode.ai/docs/agents"),
    provider: z.record(z.string(), Provider).optional().describe("Custom provider configurations and model overrides"),
    mcp: z
      .record(
        z.string(),
        z.union([
          Mcp,
          z
            .object({
              enabled: z.boolean(),
            })
            .strict(),
        ]),
      )
      .optional()
      .describe("MCP (Model Context Protocol) server configurations"),
    formatter: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.object({
            disabled: z.boolean().optional(),
            command: z.array(z.string()).optional(),
            environment: z.record(z.string(), z.string()).optional(),
            extensions: z.array(z.string()).optional(),
          }),
        ),
      ])
      .optional(),
    lsp: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.union([
            z.object({
              disabled: z.literal(true),
            }),
            z.object({
              command: z.array(z.string()),
              extensions: z.array(z.string()).optional(),
              disabled: z.boolean().optional(),
              env: z.record(z.string(), z.string()).optional(),
              initialization: z.record(z.string(), z.any()).optional(),
            }),
          ]),
        ),
      ])
      .optional()
      .refine(
        (data) => {
          if (!data) return true
          if (typeof data === "boolean") return true
          const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

          return Object.entries(data).every(([id, config]) => {
            if (config.disabled) return true
            if (serverIds.has(id)) return true
            return Boolean(config.extensions)
          })
        },
        {
          error: "For custom LSP servers, 'extensions' array is required.",
        },
      ),
    instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
    layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
    permission: Permission.optional(),
    tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead."),
    enterprise: z
      .object({
        url: z.string().optional().describe("Enterprise URL"),
      })
      .optional(),
    compaction: z
      .object({
        auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
        prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
      })
      .optional(),
    experimental: z
      .object({
        disable_paste_summary: z.boolean().optional(),
        batch_tool: z.boolean().optional().describe("Enable the batch tool (default: true)"),
        openTelemetry: z
          .boolean()
          .optional()
          .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
        primary_tools: z
          .array(z.string())
          .optional()
          .describe("Tools that should only be available to primary agents."),
        continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
        mcp_timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
        max_subagents: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of concurrent subagents per session (default: 3)"),
      })
      .optional(),
  })
  .strict()
  .meta({
    ref: "Config",
  })

export type Info = z.output<typeof Info>

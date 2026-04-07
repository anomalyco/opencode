import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import { Process } from "../util/process"
import z from "zod"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fsNode from "fs/promises"
import { NamedError } from "@opencode-ai/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { Instance, type InstanceContext } from "../project/instance"
import { LSPServer } from "../lsp/server"
import { Installation } from "@/installation"
import { ConfigMarkdown } from "./markdown"
import { constants, existsSync } from "fs"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Glob } from "../util/glob"
import { iife } from "@/util/iife"
import { Account } from "@/account"
import { isRecord } from "@/util/record"
import { ConfigPaths } from "./paths"
import { Filesystem } from "@/util/filesystem"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Duration, Effect, Layer, Option, ServiceMap } from "effect"
import { Flock } from "@/util/flock"
import { isPathPluginSpec, parsePluginSpecifier, resolvePathPluginTarget } from "@/plugin/shared"
import { Npm } from "@/npm"

export namespace Config {
  const ModelId = z.string().meta({ $ref: "https://models.dev/model-schema.json#/$defs/Model" })
  const PluginOptions = z.record(z.string(), z.unknown())
  export const PluginSpec = z.union([z.string(), z.tuple([z.string(), PluginOptions])])

  export type PluginOptions = z.infer<typeof PluginOptions>
  export type PluginSpec = z.infer<typeof PluginSpec>
  export type PluginScope = "global" | "local"
  export type PluginOrigin = {
    spec: PluginSpec
    source: string
    scope: PluginScope
  }

  const log = Log.create({ service: "config" })

  // Managed settings directory for enterprise deployments (highest priority, admin-controlled)
  // These settings override all user and project settings
  function systemManagedConfigDir(): string {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/opencode"
      case "win32":
        return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
      default:
        return "/etc/opencode"
    }
  }

  export function managedConfigDir() {
    return process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
  }

  const managedDir = managedConfigDir()

  const MANAGED_PLIST_DOMAIN = "ai.opencode.managed"

  // Keys injected by macOS/MDM into the managed plist that are not OpenCode config
  const PLIST_META = new Set([
    "PayloadDisplayName",
    "PayloadIdentifier",
    "PayloadType",
    "PayloadUUID",
    "PayloadVersion",
    "_manualProfile",
  ])

  /**
   * Parse raw JSON (from plutil conversion of a managed plist) into OpenCode config.
   * Strips MDM metadata keys before parsing through the config schema.
   * Pure function — no OS interaction, safe to unit test directly.
   */
  export function parseManagedPlist(json: string, source: string): Info {
    const raw = JSON.parse(json)
    for (const key of Object.keys(raw)) {
      if (PLIST_META.has(key)) delete raw[key]
    }
    return parseConfig(JSON.stringify(raw), source)
  }

  /**
   * Read macOS managed preferences deployed via .mobileconfig / MDM (Jamf, Kandji, etc).
   * MDM-installed profiles write to /Library/Managed Preferences/ which is only writable by root.
   * User-scoped plists are checked first, then machine-scoped.
   */
  async function readManagedPreferences(): Promise<Info> {
    if (process.platform !== "darwin") return {}

    const domain = MANAGED_PLIST_DOMAIN
    const user = os.userInfo().username
    const paths = [
      path.join("/Library/Managed Preferences", user, `${domain}.plist`),
      path.join("/Library/Managed Preferences", `${domain}.plist`),
    ]

    for (const plist of paths) {
      if (!existsSync(plist)) continue
      log.info("reading macOS managed preferences", { path: plist })
      const result = await Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })
      if (result.code !== 0) {
        log.warn("failed to convert managed preferences plist", { path: plist })
        continue
      }
      return parseManagedPlist(result.stdout.toString(), `mobileconfig:${plist}`)
    }
    return {}
  }

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
  }

  export type InstallInput = {
    signal?: AbortSignal
    waitTick?: (input: { dir: string; attempt: number; delay: number; waited: number }) => void | Promise<void>
  }

  export async function installDependencies(dir: string, input?: InstallInput) {
    if (!(await isWritable(dir))) return
    await using _ = await Flock.acquire(`config-install:${Filesystem.resolve(dir)}`, {
      signal: input?.signal,
      onWait: (tick) =>
        input?.waitTick?.({
          dir,
          attempt: tick.attempt,
          delay: tick.delay,
          waited: tick.waited,
        }),
    })
    input?.signal?.throwIfAborted()

    const pkg = path.join(dir, "package.json")
    const target = Installation.isLocal() ? "*" : Installation.VERSION
    const json = await Filesystem.readJson<{ dependencies?: Record<string, string> }>(pkg).catch(() => ({
      dependencies: {},
    }))
    json.dependencies = {
      ...json.dependencies,
      "@opencode-ai/plugin": target,
    }
    await Filesystem.writeJson(pkg, json)

    const gitignore = path.join(dir, ".gitignore")
    const ignore = await Filesystem.exists(gitignore)
    if (!ignore) {
      await Filesystem.write(
        gitignore,
        ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
      )
    }
    await Npm.install(dir)
  }

  async function isWritable(dir: string) {
    try {
      await fsNode.access(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  function rel(item: string, patterns: string[]) {
    const normalizedItem = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = normalizedItem.indexOf(pattern)
      if (index === -1) continue
      return normalizedItem.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  async function loadCommand(dir: string) {
    const result: Record<string, Command> = {}
    for (const item of await Glob.scan("{command,commands}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse command ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load command", { command: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const name = trim(file)

      const config = {
        name,
        ...md.data,
        template: md.content.trim(),
      }
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadAgent(dir: string) {
    const result: Record<string, Agent> = {}

    for (const item of await Glob.scan("{agent,agents}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse agent ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load agent", { agent: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.opencode/agent/", "/.opencode/agents/", "/agent/", "/agents/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const agentName = trim(file)

      const config = {
        name: agentName,
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  async function loadMode(dir: string) {
    const result: Record<string, Agent> = {}
    for (const item of await Glob.scan("{mode,modes}/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse mode ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load mode", { mode: item, err })
        return undefined
      })
      if (!md) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = {
          ...parsed.data,
          mode: "primary" as const,
        }
        continue
      }
    }
    return result
  }

  async function loadPlugin(dir: string) {
    const plugins: PluginSpec[] = []

    for (const item of await Glob.scan("{plugin,plugins}/*.{ts,js}", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      plugins.push(pathToFileURL(item).href)
    }
    return plugins
  }

  export function pluginSpecifier(plugin: PluginSpec): string {
    return Array.isArray(plugin) ? plugin[0] : plugin
  }

  export function pluginOptions(plugin: PluginSpec): PluginOptions | undefined {
    return Array.isArray(plugin) ? plugin[1] : undefined
  }

  export async function resolvePluginSpec(plugin: PluginSpec, configFilepath: string): Promise<PluginSpec> {
    const spec = pluginSpecifier(plugin)
    if (!isPathPluginSpec(spec)) return plugin

    const base = path.dirname(configFilepath)
    const file = (() => {
      if (spec.startsWith("file://")) return spec
      if (path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)) return pathToFileURL(spec).href
      return pathToFileURL(path.resolve(base, spec)).href
    })()

    const resolved = await resolvePathPluginTarget(file).catch(() => file)

    if (Array.isArray(plugin)) return [resolved, plugin[1]]
    return resolved
  }

  export function deduplicatePluginOrigins(plugins: PluginOrigin[]): PluginOrigin[] {
    const seen = new Set<string>()
    const list: PluginOrigin[] = []

    for (const plugin of plugins.toReversed()) {
      const spec = pluginSpecifier(plugin.spec)
      const name = spec.startsWith("file://") ? spec : parsePluginSpecifier(spec).pkg
      if (seen.has(name)) continue
      seen.add(name)
      list.push(plugin)
    }

    return list.toReversed()
  }

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
        .describe(
          "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
        ),
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
    model: ModelId.optional(),
    subtask: z.boolean().optional(),
  })
  export type Command = z.infer<typeof Command>

  export const Skills = z.object({
    paths: z.array(z.string()).optional().describe("Additional paths to skill folders"),
    urls: z
      .array(z.string())
      .optional()
      .describe("URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)"),
  })
  export type Skills = z.infer<typeof Skills>

  export const Agent = z
    .object({
      model: ModelId.optional(),
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
      messages_half_page_down: z
        .string()
        .optional()
        .default("ctrl+alt+d")
        .describe("Scroll messages down by half page"),
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
      input_select_line_home: z
        .string()
        .optional()
        .default("ctrl+shift+a")
        .describe("Select to start of line in input"),
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
      session_child_first: z.string().optional().default("<leader>down").describe("Go to first child session"),
      session_child_cycle: z.string().optional().default("right").describe("Go to next child session"),
      session_child_cycle_reverse: z.string().optional().default("left").describe("Go to previous child session"),
      session_parent: z.string().optional().default("up").describe("Go to parent session"),
      terminal_suspend: z.string().optional().default("ctrl+z").describe("Suspend terminal"),
      terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
      tips_toggle: z.string().optional().default("<leader>h").describe("Toggle tips on home screen"),
      plugin_manager: z.string().optional().default("none").describe("Open plugin manager dialog"),
      display_thinking: z.string().optional().default("none").describe("Toggle thinking blocks visibility"),
    })
    .strict()
    .meta({
      ref: "KeybindsConfig",
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
          chunkTimeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              "Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.",
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
      logLevel: Log.Level.optional().describe("Log level"),
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
      snapshot: z
        .boolean()
        .optional()
        .describe(
          "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
        ),
      plugin: PluginSpec.array().optional(),
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
      model: ModelId.describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      small_model: ModelId.describe(
        "Small model to use for tasks like title generation in the format of provider/model",
      ).optional(),
      default_agent: z
        .string()
        .optional()
        .describe(
          "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
        ),
      username: z
        .string()
        .optional()
        .describe("Custom username to display in conversations instead of system username"),
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
      provider: z
        .record(z.string(), Provider)
        .optional()
        .describe("Custom provider configurations and model overrides"),
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
      tools: z.record(z.string(), z.boolean()).optional(),
      enterprise: z
        .object({
          url: z.string().optional().describe("Enterprise URL"),
        })
        .optional(),
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
          prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
          reserved: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Token buffer for compaction. Leaves enough window to avoid overflow during compaction."),
        })
        .optional(),
      experimental: z
        .object({
          disable_paste_summary: z.boolean().optional(),
          batch_tool: z.boolean().optional().describe("Enable the batch tool"),
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
        })
        .optional(),
    })
    .strict()
    .meta({
      ref: "Config",
    })

  export type Info = z.output<typeof Info> & {
    plugin_origins?: PluginOrigin[]
  }

  type State = {
    config: Info
    directories: string[]
    deps: Promise<void>[]
    consoleState: ConsoleState
  }

  export interface Interface {
    readonly get: () => Effect.Effect<Info>
    readonly getGlobal: () => Effect.Effect<Info>
    readonly getConsoleState: () => Effect.Effect<ConsoleState>
    readonly update: (config: Info) => Effect.Effect<void>
    readonly updateGlobal: (config: Info) => Effect.Effect<Info>
    readonly invalidate: (wait?: boolean) => Effect.Effect<void>
    readonly directories: () => Effect.Effect<string[]>
    readonly waitForDependencies: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Config") {}

  function globalConfigFile() {
    const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) =>
      path.join(Global.Path.config, file),
    )
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[0]
  }

  function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
    if (!isRecord(patch)) {
      const edits = modify(input, path, patch, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      })
      return applyEdits(input, edits)
    }

    return Object.entries(patch).reduce((result, [key, value]) => {
      if (value === undefined) return result
      return patchJsonc(result, value, [...path, key])
    }, input)
  }

  function writable(info: Info) {
    const { plugin_origins, ...next } = info
    return next
  }

  function parseConfig(text: string, filepath: string): Info {
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: filepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    const parsed = Info.safeParse(data)
    if (parsed.success) return parsed.data

    throw new InvalidError({
      path: filepath,
      issues: parsed.error.issues,
    })
  }

  export const { JsonError, InvalidError } = ConfigPaths

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Auth.Service | Account.Service> =
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const authSvc = yield* Auth.Service
        const accountSvc = yield* Account.Service

        const readConfigFile = Effect.fnUntraced(function* (filepath: string) {
          return yield* fs.readFileString(filepath).pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "NotFound",
              () => Effect.succeed(undefined),
            ),
            Effect.orDie,
          )
        })

        const loadConfig = Effect.fnUntraced(function* (
          text: string,
          options: { path: string } | { dir: string; source: string },
        ) {
          const original = text
          const source = "path" in options ? options.path : options.source
          const isFile = "path" in options
          const data = yield* Effect.promise(() =>
            ConfigPaths.parseText(
              text,
              "path" in options ? options.path : { source: options.source, dir: options.dir },
            ),
          )

          const normalized = (() => {
            if (!data || typeof data !== "object" || Array.isArray(data)) return data
            const copy = { ...(data as Record<string, unknown>) }
            const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
            if (!hadLegacy) return copy
            delete copy.theme
            delete copy.keybinds
            delete copy.tui
            log.warn("tui keys in opencode config are deprecated; move them to tui.json", { path: source })
            return copy
          })()

          const parsed = Info.safeParse(normalized)
          if (parsed.success) {
            if (!parsed.data.$schema && isFile) {
              parsed.data.$schema = "https://opencode.ai/config.json"
              const updated = original.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
              yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
            }
            const data = parsed.data
            if (data.plugin && isFile) {
              const list = data.plugin
              for (let i = 0; i < list.length; i++) {
                list[i] = yield* Effect.promise(() => resolvePluginSpec(list[i], options.path))
              }
            }
            return data
          }

          throw new InvalidError({
            path: source,
            issues: parsed.error.issues,
          })
        })

        const loadFile = Effect.fnUntraced(function* (filepath: string) {
          log.info("loading", { path: filepath })
          const text = yield* readConfigFile(filepath)
          if (!text) return {} as Info
          return yield* loadConfig(text, { path: filepath })
        })

        const loadGlobal = Effect.fnUntraced(function* () {
          let result: Info = pipe(
            {},
            mergeDeep(yield* loadFile(path.join(Global.Path.config, "config.json"))),
            mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.json"))),
            mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
          )

          const legacy = path.join(Global.Path.config, "config")
          if (existsSync(legacy)) {
            yield* Effect.promise(() =>
              import(pathToFileURL(legacy).href, { with: { type: "toml" } })
                .then(async (mod) => {
                  const { provider, model, ...rest } = mod.default
                  if (provider && model) result.model = `${provider}/${model}`
                  result["$schema"] = "https://opencode.ai/config.json"
                  result = mergeDeep(result, rest)
                  await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
                  await fsNode.unlink(legacy)
                })
                .catch(() => {}),
            )
          }

          return result
        })

        const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
          loadGlobal().pipe(
            Effect.tapError((error) =>
              Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
            ),
            Effect.orElseSucceed((): Info => ({})),
          ),
          Duration.infinity,
        )

        const getGlobal = Effect.fn("Config.getGlobal")(function* () {
          return yield* cachedGlobal
        })

        const loadInstanceState = Effect.fnUntraced(function* (ctx: InstanceContext) {
          const auth = yield* authSvc.all().pipe(Effect.orDie)

          let result: Info = {}
          const consoleManagedProviders = new Set<string>()
          let activeOrgName: string | undefined

          const scope = (source: string): PluginScope => {
            if (source.startsWith("http://") || source.startsWith("https://")) return "global"
            if (source === "OPENCODE_CONFIG_CONTENT") return "local"
            if (Instance.containsPath(source)) return "local"
            return "global"
          }

          const track = (source: string, list: PluginSpec[] | undefined, kind?: PluginScope) => {
            if (!list?.length) return
            const hit = kind ?? scope(source)
            const plugins = deduplicatePluginOrigins([
              ...(result.plugin_origins ?? []),
              ...list.map((spec) => ({ spec, source, scope: hit })),
            ])
            result.plugin = plugins.map((item) => item.spec)
            result.plugin_origins = plugins
          }

          const merge = (source: string, next: Info, kind?: PluginScope) => {
            result = mergeConfigConcatArrays(result, next)
            track(source, next.plugin, kind)
          }

          for (const [key, value] of Object.entries(auth)) {
            if (value.type === "wellknown") {
              const url = key.replace(/\/+$/, "")
              process.env[value.key] = value.token
              log.debug("fetching remote config", { url: `${url}/.well-known/opencode` })
              const response = yield* Effect.promise(() => fetch(`${url}/.well-known/opencode`))
              if (!response.ok) {
                throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
              }
              const wellknown = (yield* Effect.promise(() => response.json())) as any
              const remoteConfig = wellknown.config ?? {}
              if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
              const source = `${url}/.well-known/opencode`
              const next = yield* loadConfig(JSON.stringify(remoteConfig), {
                dir: path.dirname(source),
                source,
              })
              merge(source, next, "global")
              log.debug("loaded remote config from well-known", { url })
            }
          }

          const global = yield* getGlobal()
          merge(Global.Path.config, global, "global")

          if (Flag.OPENCODE_CONFIG) {
            merge(Flag.OPENCODE_CONFIG, yield* loadFile(Flag.OPENCODE_CONFIG))
            log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
          }

          if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
            for (const file of yield* Effect.promise(() =>
              ConfigPaths.projectFiles("opencode", ctx.directory, ctx.worktree),
            )) {
              merge(file, yield* loadFile(file), "local")
            }
          }

          result.agent = result.agent || {}
          result.mode = result.mode || {}
          result.plugin = result.plugin || []

          const directories = yield* Effect.promise(() => ConfigPaths.directories(ctx.directory, ctx.worktree))

          if (Flag.OPENCODE_CONFIG_DIR) {
            log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
          }

          const deps: Promise<void>[] = []

          for (const dir of unique(directories)) {
            if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
              for (const file of ["opencode.json", "opencode.jsonc"]) {
                const source = path.join(dir, file)
                log.debug(`loading config from ${source}`)
                merge(source, yield* loadFile(source))
                result.agent ??= {}
                result.mode ??= {}
                result.plugin ??= []
              }
            }

            const dep = iife(async () => {
              await installDependencies(dir)
            })
            void dep.catch((err) => {
              log.warn("background dependency install failed", { dir, error: err })
            })
            deps.push(dep)

            result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => loadCommand(dir)))
            result.agent = mergeDeep(result.agent, yield* Effect.promise(() => loadAgent(dir)))
            result.agent = mergeDeep(result.agent, yield* Effect.promise(() => loadMode(dir)))
            const list = yield* Effect.promise(() => loadPlugin(dir))
            track(dir, list)
          }

          if (process.env.OPENCODE_CONFIG_CONTENT) {
            const source = "OPENCODE_CONFIG_CONTENT"
            const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
              dir: ctx.directory,
              source,
            })
            merge(source, next, "local")
            log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
          }

          const activeOrg = Option.getOrUndefined(
            yield* accountSvc.activeOrg().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
          )
          if (activeOrg) {
            yield* Effect.gen(function* () {
              const [configOpt, tokenOpt] = yield* Effect.all(
                [accountSvc.config(activeOrg.account.id, activeOrg.org.id), accountSvc.token(activeOrg.account.id)],
                { concurrency: 2 },
              )
              if (Option.isSome(tokenOpt)) {
                process.env["OPENCODE_CONSOLE_TOKEN"] = tokenOpt.value
                Env.set("OPENCODE_CONSOLE_TOKEN", tokenOpt.value)
              }

              activeOrgName = activeOrg.org.name

              if (Option.isSome(configOpt)) {
                const source = `${activeOrg.account.url}/api/config`
                const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                  dir: path.dirname(source),
                  source,
                })
                for (const providerID of Object.keys(next.provider ?? {})) {
                  consoleManagedProviders.add(providerID)
                }
                merge(source, next, "global")
              }
            }).pipe(
              Effect.catch((err) => {
                log.debug("failed to fetch remote account config", {
                  error: err instanceof Error ? err.message : String(err),
                })
                return Effect.void
              }),
            )
          }

          if (existsSync(managedDir)) {
            for (const file of ["opencode.json", "opencode.jsonc"]) {
              const source = path.join(managedDir, file)
              merge(source, yield* loadFile(source), "global")
            }
          }

          // macOS managed preferences (.mobileconfig deployed via MDM) override everything
          result = mergeConfigConcatArrays(result, yield* Effect.promise(() => readManagedPreferences()))

          for (const [name, mode] of Object.entries(result.mode ?? {})) {
            result.agent = mergeDeep(result.agent ?? {}, {
              [name]: {
                ...mode,
                mode: "primary" as const,
              },
            })
          }

          if (Flag.OPENCODE_PERMISSION) {
            result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
          }

          if (result.tools) {
            const perms: Record<string, Config.PermissionAction> = {}
            for (const [tool, enabled] of Object.entries(result.tools)) {
              const action: Config.PermissionAction = enabled ? "allow" : "deny"
              if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
                perms.edit = action
                continue
              }
              perms[tool] = action
            }
            result.permission = mergeDeep(perms, result.permission ?? {})
          }

          if (!result.username) result.username = os.userInfo().username

          if (result.autoshare === true && !result.share) {
            result.share = "auto"
          }

          if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
            result.compaction = { ...result.compaction, auto: false }
          }
          if (Flag.OPENCODE_DISABLE_PRUNE) {
            result.compaction = { ...result.compaction, prune: false }
          }

          return {
            config: result,
            directories,
            deps,
            consoleState: {
              consoleManagedProviders: Array.from(consoleManagedProviders),
              activeOrgName,
              switchableOrgCount: 0,
            },
          }
        })

        const state = yield* InstanceState.make<State>(
          Effect.fn("Config.state")(function* (ctx) {
            return yield* loadInstanceState(ctx)
          }),
        )

        const get = Effect.fn("Config.get")(function* () {
          return yield* InstanceState.use(state, (s) => s.config)
        })

        const directories = Effect.fn("Config.directories")(function* () {
          return yield* InstanceState.use(state, (s) => s.directories)
        })

        const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
          return yield* InstanceState.use(state, (s) => s.consoleState)
        })

        const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
          yield* InstanceState.useEffect(state, (s) => Effect.promise(() => Promise.all(s.deps).then(() => undefined)))
        })

        const update = Effect.fn("Config.update")(function* (config: Info) {
          const dir = yield* InstanceState.directory
          const file = path.join(dir, "config.json")
          const existing = yield* loadFile(file)
          yield* fs
            .writeFileString(file, JSON.stringify(mergeDeep(writable(existing), writable(config)), null, 2))
            .pipe(Effect.orDie)
          yield* Effect.promise(() => Instance.dispose())
        })

        const invalidate = Effect.fn("Config.invalidate")(function* (wait?: boolean) {
          yield* invalidateGlobal
          const task = Instance.disposeAll()
            .catch(() => undefined)
            .finally(() =>
              GlobalBus.emit("event", {
                directory: "global",
                payload: {
                  type: Event.Disposed.type,
                  properties: {},
                },
              }),
            )
          if (wait) yield* Effect.promise(() => task)
          else void task
        })

        const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
          const file = globalConfigFile()
          const before = (yield* readConfigFile(file)) ?? "{}"
          const input = writable(config)

          let next: Info
          if (!file.endsWith(".jsonc")) {
            const existing = parseConfig(before, file)
            const merged = mergeDeep(writable(existing), input)
            yield* fs.writeFileString(file, JSON.stringify(merged, null, 2)).pipe(Effect.orDie)
            next = merged
          } else {
            const updated = patchJsonc(before, input)
            next = parseConfig(updated, file)
            yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
          }

          yield* invalidate()
          return next
        })

        return Service.of({
          get,
          getGlobal,
          getConsoleState,
          update,
          updateGlobal,
          invalidate,
          directories,
          waitForDependencies,
        })
      }),
    )

  export const defaultLayer = layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Account.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get() {
    return runPromise((svc) => svc.get())
  }

  export async function getGlobal() {
    return runPromise((svc) => svc.getGlobal())
  }

  export async function getConsoleState() {
    return runPromise((svc) => svc.getConsoleState())
  }

  export async function update(config: Info) {
    return runPromise((svc) => svc.update(config))
  }

  export async function updateGlobal(config: Info) {
    return runPromise((svc) => svc.updateGlobal(config))
  }

  export async function invalidate(wait = false) {
    return runPromise((svc) => svc.invalidate(wait))
  }

  export async function directories() {
    return runPromise((svc) => svc.directories())
  }

  export async function waitForDependencies() {
    return runPromise((svc) => svc.waitForDependencies())
  }
}

import { Log } from "../util/log"
import path from "path"
import os from "os"
import { z } from "zod"
import { App } from "../app/app"
import { Filesystem } from "../util/filesystem"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "../util/error"
import matter from "gray-matter"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"

export namespace Config {
  const log = Log.create({ service: "config" })

  export const state = App.state("config", async (app) => {
    const auth = await Auth.all()
    let result = await global()
    for (const file of ["opencode.jsonc", "opencode.json"]) {
      const found = await Filesystem.findUp(file, app.path.cwd, app.path.root)
      for (const resolved of found.toReversed()) {
        result = mergeDeep(result, await loadFile(resolved))
      }
    }

    // Override with custom config if provided
    if (Flag.OPENCODE_CONFIG) {
      result = mergeDeep(result, await loadFile(Flag.OPENCODE_CONFIG))
      log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
    }

    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        process.env[value.key] = value.token
        const wellknown = await fetch(`${key}/.well-known/opencode`).then((x) => x.json())
        result = mergeDeep(result, await load(JSON.stringify(wellknown.config ?? {}), process.cwd()))
      }
    }

    result.agent = result.agent || {}
    const markdownAgents = [
      ...(await Filesystem.globUp("agent/*.md", Global.Path.config, Global.Path.config)),
      ...(await Filesystem.globUp(".opencode/agent/*.md", app.path.cwd, app.path.root)),
    ]
    for (const item of markdownAgents) {
      const content = await Bun.file(item).text()
      const md = matter(content)
      if (!md.data) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result.agent = mergeDeep(result.agent, {
          [config.name]: parsed.data,
        })
        continue
      }
      throw new InvalidError({ path: item }, { cause: parsed.error })
    }

    // Load mode markdown files
    result.mode = result.mode || {}
    const markdownModes = [
      ...(await Filesystem.globUp("mode/*.md", Global.Path.config, Global.Path.config)),
      ...(await Filesystem.globUp(".opencode/mode/*.md", app.path.cwd, app.path.root)),
    ]
    for (const item of markdownModes) {
      const content = await Bun.file(item).text()
      const md = matter(content)
      if (!md.data) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result.mode = mergeDeep(result.mode, {
          [config.name]: parsed.data,
        })
        continue
      }
      throw new InvalidError({ path: item }, { cause: parsed.error })
    }
    // Migrate deprecated mode field to agent field
    for (const [name, mode] of Object.entries(result.mode)) {
      result.agent = mergeDeep(result.agent ?? {}, {
        [name]: {
          ...mode,
          mode: "primary" as const,
        },
      })
    }

    result.plugin = result.plugin || []
    result.plugin.push(
      ...[
        ...(await Filesystem.globUp("plugin/*.ts", Global.Path.config, Global.Path.config)),
        ...(await Filesystem.globUp(".opencode/plugin/*.ts", app.path.cwd, app.path.root)),
      ].map((x) => "file://" + x),
    )

    // Handle migration from autoshare to share field
    if (result.autoshare === true && !result.share) {
      result.share = "auto"
    }
    if (result.keybinds?.messages_revert && !result.keybinds.messages_undo) {
      result.keybinds.messages_undo = result.keybinds.messages_revert
    }
    if (result.keybinds?.switch_mode && !result.keybinds.switch_agent) {
      result.keybinds.switch_agent = result.keybinds.switch_mode
    }
    if (result.keybinds?.switch_mode_reverse && !result.keybinds.switch_agent_reverse) {
      result.keybinds.switch_agent_reverse = result.keybinds.switch_mode_reverse
    }

    if (!result.username) {
      const os = await import("os")
      result.username = os.userInfo().username
    }

    log.info("loaded", result)

    return result
  })

  export const McpLocal = z
    .object({
      type: z.literal("local").describe("Type of MCP server connection"),
      command: z.string().array().describe("Command and arguments to run the MCP server"),
      environment: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables to set when running the MCP server"),
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    })
    .strict()
    .openapi({
      ref: "McpLocalConfig",
    })

  export const McpRemote = z
    .object({
      type: z.literal("remote").describe("Type of MCP server connection"),
      url: z.string().describe("URL of the remote MCP server"),
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
    })
    .strict()
    .openapi({
      ref: "McpRemoteConfig",
    })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const Agent = z
    .object({
      model: z.string().optional(),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()).optional(),
      disable: z.boolean().optional(),
      description: z.string().optional().describe("Description of when to use the agent"),
      mode: z.union([z.literal("subagent"), z.literal("primary"), z.literal("all")]).optional(),
    })
    .openapi({
      ref: "AgentConfig",
    })
  export type Agent = z.infer<typeof Agent>

  export const Keybinds = z
    .object({
      leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
      app_help: z.string().optional().default("<leader>h").describe("Show help dialog"),
      switch_mode: z.string().optional().default("none").describe("@deprecated use switch_agent. Next mode"),
      switch_mode_reverse: z
        .string()
        .optional()
        .default("none")
        .describe("@deprecated use switch_agent_reverse. Previous mode"),
      switch_agent: z.string().optional().default("tab").describe("Next agent"),
      switch_agent_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
      editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
      session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
      session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
      session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
      session_share: z.string().optional().default("<leader>s").describe("Share current session"),
      session_unshare: z.string().optional().default("none").describe("Unshare current session"),
      session_interrupt: z.string().optional().default("esc").describe("Interrupt current session"),
      session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
      tool_details: z.string().optional().default("<leader>d").describe("Toggle tool details"),
      model_list: z.string().optional().default("<leader>m").describe("List available models"),
      theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
      file_list: z.string().optional().default("<leader>f").describe("List files"),
      file_close: z.string().optional().default("esc").describe("Close file"),
      file_search: z.string().optional().default("<leader>/").describe("Search file"),
      file_diff_toggle: z.string().optional().default("<leader>v").describe("Split/unified diff"),
      project_init: z.string().optional().default("<leader>i").describe("Create/update AGENTS.md"),
      input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
      input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
      input_submit: z.string().optional().default("enter").describe("Submit input"),
      input_newline: z.string().optional().default("shift+enter,ctrl+j").describe("Insert newline in input"),
      messages_page_up: z.string().optional().default("pgup").describe("Scroll messages up by one page"),
      messages_page_down: z.string().optional().default("pgdown").describe("Scroll messages down by one page"),
      messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
      messages_half_page_down: z
        .string()
        .optional()
        .default("ctrl+alt+d")
        .describe("Scroll messages down by half page"),
      messages_previous: z.string().optional().default("ctrl+up").describe("Navigate to previous message"),
      messages_next: z.string().optional().default("ctrl+down").describe("Navigate to next message"),
      messages_first: z.string().optional().default("ctrl+g").describe("Navigate to first message"),
      messages_last: z.string().optional().default("ctrl+alt+g").describe("Navigate to last message"),
      messages_layout_toggle: z.string().optional().default("<leader>p").describe("Toggle layout"),
      messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
      messages_revert: z.string().optional().default("none").describe("@deprecated use messages_undo. Revert message"),
      messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
      messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
      app_exit: z.string().optional().default("ctrl+c,<leader>q").describe("Exit the application"),
    })
    .strict()
    .openapi({
      ref: "KeybindsConfig",
    })

  export const Layout = z.enum(["auto", "stretch"]).openapi({
    ref: "LayoutConfig",
  })
  export type Layout = z.infer<typeof Layout>

  export const Permission = z.union([z.literal("ask"), z.literal("allow"), z.literal("deny")])
  export type Permission = z.infer<typeof Permission>

  export const Info = z
    .object({
      $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
      theme: z.string().optional().describe("Theme name to use for the interface"),
      keybinds: Keybinds.optional().describe("Custom keybind configurations"),
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
      autoupdate: z.boolean().optional().describe("Automatically update to the latest version"),
      disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
      model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      small_model: z
        .string()
        .describe("Small model to use for tasks like title generation in the format of provider/model")
        .optional(),
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
          plan: Agent.optional(),
          build: Agent.optional(),
          general: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("Agent configuration, see https://opencode.ai/docs/agent"),
      provider: z
        .record(
          ModelsDev.Provider.partial()
            .extend({
              models: z.record(ModelsDev.Model.partial()),
              options: z
                .object({
                  apiKey: z.string().optional(),
                  baseURL: z.string().optional(),
                })
                .catchall(z.any())
                .optional(),
            })
            .strict(),
        )
        .optional()
        .describe("Custom provider configurations and model overrides"),
      mcp: z.record(z.string(), Mcp).optional().describe("MCP (Model Context Protocol) server configurations"),
      formatter: z
        .record(
          z.string(),
          z.object({
            disabled: z.boolean().optional(),
            command: z.array(z.string()).optional(),
            environment: z.record(z.string(), z.string()).optional(),
            extensions: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      lsp: z
        .record(
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
        )
        .optional(),
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
      layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
      permission: z
        .object({
          edit: Permission.optional(),
          bash: z.union([Permission, z.record(z.string(), Permission)]).optional(),
        })
        .optional(),
      experimental: z
        .object({
          hook: z
            .object({
              file_edited: z
                .record(
                  z.string(),
                  z
                    .object({
                      command: z.string().array(),
                      environment: z.record(z.string(), z.string()).optional(),
                    })
                    .array(),
                )
                .optional(),
              session_completed: z
                .object({
                  command: z.string().array(),
                  environment: z.record(z.string(), z.string()).optional(),
                })
                .array()
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .strict()
    .openapi({
      ref: "Config",
    })

  export type Info = z.output<typeof Info>

  export const global = lazy(async () => {
    let result: Info = pipe(
      {},
      mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "opencode.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
    )

    await import(path.join(Global.Path.config, "config"), {
      with: {
        type: "toml",
      },
    })
      .then(async (mod) => {
        const { provider, model, ...rest } = mod.default
        if (provider && model) result.model = `${provider}/${model}`
        result["$schema"] = "https://opencode.ai/config.json"
        result = mergeDeep(result, rest)
        await Bun.write(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
        await fs.unlink(path.join(Global.Path.config, "config"))
      })
      .catch(() => {})

    return result
  })

  async function loadFile(filepath: string): Promise<Info> {
    log.info("loading", { path: filepath })
    let text = await Bun.file(filepath)
      .text()
      .catch((err) => {
        if (err.code === "ENOENT") return
        throw new JsonError({ path: filepath }, { cause: err })
      })
    if (!text) return {}
    return load(text, filepath)
  }

  async function load(text: string, filepath: string) {
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    const fileMatches = text.match(/\{file:[^}]+\}/g)
    if (fileMatches) {
      const configDir = path.dirname(filepath)
      const lines = text.split("\n")

      for (const match of fileMatches) {
        const lineIndex = lines.findIndex((line) => line.includes(match))
        if (lineIndex !== -1 && lines[lineIndex].trim().startsWith("//")) {
          continue // Skip if line is commented
        }
        let filePath = match.replace(/^\{file:/, "").replace(/\}$/, "")
        if (filePath.startsWith("~/")) {
          filePath = path.join(os.homedir(), filePath.slice(2))
        }
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
        const fileContent = (await Bun.file(resolvedPath).text()).trim()
        // escape newlines/quotes, strip outer quotes
        text = text.replace(match, JSON.stringify(fileContent).slice(1, -1))
      }
    }

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
    if (parsed.success) {
      if (!parsed.data.$schema) {
        parsed.data.$schema = "https://opencode.ai/config.json"
        await Bun.write(filepath, JSON.stringify(parsed.data, null, 2))
      }
      const data = parsed.data
      if (data.plugin) {
        for (let i = 0; i < data.plugin?.length; i++) {
          const plugin = data.plugin[i]
          try {
            data.plugin[i] = import.meta.resolve(plugin, filepath)
          } catch (err) {}
        }
      }
      return data
    }

    throw new InvalidError({ path: filepath, issues: parsed.error.issues })
  }
  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
    }),
  )

  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      path: z.string(),
      issues: z.custom<z.ZodIssue[]>().optional(),
    }),
  )

  export function get() {
    return state()
  }
}

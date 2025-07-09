import { Log } from "../util/log"
import path from "path"
import { z } from "zod"
import { App } from "../app/app"
import { Filesystem } from "../util/filesystem"
import { ModelsDev } from "../provider/models"
import { mergeDeep } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "../util/error"

export namespace Config {
  const log = Log.create({ service: "config" })

  export const state = App.state("config", async (app) => {
    let result = await global()
    for (const file of ["opencode.jsonc", "opencode.json"]) {
      const found = await Filesystem.findUp(file, app.path.cwd, app.path.root)
      for (const resolved of found.toReversed()) {
        result = mergeDeep(result, await load(resolved))
      }
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
    })
    .strict()
    .openapi({
      ref: "McpRemoteConfig",
    })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const Keybinds = z
    .object({
      leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
      app_help: z.string().optional().default("<leader>h").describe("Show help dialog"),
      editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
      session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
      session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
      session_share: z.string().optional().default("<leader>s").describe("Share current session"),
      session_unshare: z.string().optional().default("<leader>u").describe("Unshare current session"),
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
      messages_revert: z.string().optional().default("<leader>r").describe("Revert message"),
      app_exit: z.string().optional().default("ctrl+c,<leader>q").describe("Exit the application"),
    })
    .strict()
    .openapi({
      ref: "KeybindsConfig",
    })
  export const Info = z
    .object({
      $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
      theme: z.string().optional().describe("Theme name to use for the interface"),
      keybinds: Keybinds.optional().describe("Custom keybind configurations"),
      autoshare: z.boolean().optional().describe("Share newly created sessions automatically"),
      autoupdate: z.boolean().optional().describe("Automatically update to the latest version"),
      disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
      model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      log_level: Log.Level.optional().describe("Minimum log level to write to log files"),
      provider: z
        .record(
          ModelsDev.Provider.partial().extend({
            models: z.record(ModelsDev.Model.partial()),
            options: z.record(z.any()).optional(),
          }),
        )
        .optional()
        .describe("Custom provider configurations and model overrides"),
      mcp: z.record(z.string(), Mcp).optional().describe("MCP (Model Context Protocol) server configurations"),
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
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
    let result = await load(path.join(Global.Path.config, "config.json"))

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

  async function load(path: string) {
    const data = await Bun.file(path)
      .json()
      .catch((err) => {
        if (err.code === "ENOENT") return {}
        throw new JsonError({ path }, { cause: err })
      })

    const parsed = Info.safeParse(data)
    if (parsed.success) return parsed.data
    throw new InvalidError({ path, issues: parsed.error.issues })
  }

  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
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

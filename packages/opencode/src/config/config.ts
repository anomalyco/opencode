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
      command: z
        .string()
        .array()
        .describe("Command and arguments to run the MCP server"),
      environment: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables to set when running the MCP server"),
      enabled: z
        .boolean()
        .optional()
        .describe("Enable or disable the MCP server on startup"),
    })
    .strict()
    .openapi({
      ref: "McpLocalConfig",
    })

  export const McpRemote = z
    .object({
      type: z.literal("remote").describe("Type of MCP server connection"),
      url: z.string().describe("URL of the remote MCP server"),
      enabled: z
        .boolean()
        .optional()
        .describe("Enable or disable the MCP server on startup"),
    })
    .strict()
    .openapi({
      ref: "McpRemoteConfig",
    })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const Keybinds = z
    .object({
      leader: z
        .string()
        .optional()
        .describe("Leader key for keybind combinations"),
      help: z.string().optional().describe("Show help dialog"),
      editor_open: z.string().optional().describe("Open external editor"),
      session_new: z.string().optional().describe("Create a new session"),
      session_list: z.string().optional().describe("List all sessions"),
      session_share: z.string().optional().describe("Share current session"),
      session_interrupt: z
        .string()
        .optional()
        .describe("Interrupt current session"),
      session_compact: z
        .string()
        .optional()
        .describe("Toggle compact mode for session"),
      tool_details: z.string().optional().describe("Show tool details"),
      model_list: z.string().optional().describe("List available models"),
      theme_list: z.string().optional().describe("List available themes"),
      project_init: z
        .string()
        .optional()
        .describe("Initialize project configuration"),
      input_clear: z.string().optional().describe("Clear input field"),
      input_paste: z.string().optional().describe("Paste from clipboard"),
      input_submit: z.string().optional().describe("Submit input"),
      input_newline: z.string().optional().describe("Insert newline in input"),
      history_previous: z
        .string()
        .optional()
        .describe("Navigate to previous history item"),
      history_next: z
        .string()
        .optional()
        .describe("Navigate to next history item"),
      messages_page_up: z
        .string()
        .optional()
        .describe("Scroll messages up by one page"),
      messages_page_down: z
        .string()
        .optional()
        .describe("Scroll messages down by one page"),
      messages_half_page_up: z
        .string()
        .optional()
        .describe("Scroll messages up by half page"),
      messages_half_page_down: z
        .string()
        .optional()
        .describe("Scroll messages down by half page"),
      messages_previous: z
        .string()
        .optional()
        .describe("Navigate to previous message"),
      messages_next: z.string().optional().describe("Navigate to next message"),
      messages_first: z
        .string()
        .optional()
        .describe("Navigate to first message"),
      messages_last: z.string().optional().describe("Navigate to last message"),
      app_exit: z.string().optional().describe("Exit the application"),
    })
    .strict()
    .openapi({
      ref: "KeybindsConfig",
    })
  export const Info = z
    .object({
      $schema: z
        .string()
        .optional()
        .describe("JSON schema reference for configuration validation"),
      theme: z
        .string()
        .optional()
        .describe("Theme name to use for the interface"),
      keybinds: Keybinds.optional().describe("Custom keybind configurations"),
      autoshare: z
        .boolean()
        .optional()
        .describe("Share newly created sessions automatically"),
      autoupdate: z
        .boolean()
        .optional()
        .describe("Automatically update to the latest version"),
      disabled_providers: z
        .array(z.string())
        .optional()
        .describe("Disable providers that are loaded automatically"),
      model: z
        .string()
        .describe(
          "Model to use in the format of provider/model, eg anthropic/claude-2",
        )
        .optional(),
      provider: z
        .record(
          ModelsDev.Provider.partial().extend({
            models: z.record(ModelsDev.Model.partial()),
            options: z.record(z.any()).optional(),
          }),
        )
        .optional()
        .describe("Custom provider configurations and model overrides"),
      mcp: z
        .record(z.string(), Mcp)
        .optional()
        .describe("MCP (Model Context Protocol) server configurations"),
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
        await Bun.write(
          path.join(Global.Path.config, "config.json"),
          JSON.stringify(result, null, 2),
        )
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

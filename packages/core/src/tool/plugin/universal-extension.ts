export * as UniversalExtensionTool from "./universal-extension.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { ExtensionRegistry } from "../../extension/registry.js"

export const name = "universal_extension"

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "get"]).annotate({
    description: "Action to perform: 'list' (list installed universal extensions) or 'get' (get extension details).",
  }),
  idOrName: Schema.optional(Schema.String).annotate({
    description: "The ID or name of the extension to retrieve. Required for 'get'.",
  }),
})

export const Output = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
})

export const description = [
  "Inspect Universal Extensions installed across ecosystems (OpenCode, Claude Code, OpenAI Codex, Antigravity, Cursor).",
  "Use action 'list' to see all installed skills, MCP servers, rules, and plugins.",
  "Use action 'get' with 'idOrName' to inspect the capabilities, platform origin, and security status of an extension.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.universal_extension",
  effect: Effect.fn("UniversalExtensionTool.Plugin")(function* (ctx: Context) {
    const registry = yield* ExtensionRegistry.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input) =>
          Effect.gen(function* () {
            if (input.action === "list") {
              const all = yield* registry.list()
              const out = {
                success: true,
                message: `Found ${all.length} universal extensions installed.`,
                data: all.map((ext) => ({
                  id: ext.id,
                  name: ext.name,
                  category: ext.category,
                  originPlatform: ext.originPlatform,
                  scope: ext.scope,
                  status: ext.status,
                  enabled: ext.enabled,
                })),
              }
              return {
                output: out,
                content: `${out.message}\n` + all.map((e) => `- ${e.name} [${e.category}/${e.originPlatform}] (${e.status})`).join("\n"),
              }
            }

            if (input.action === "get") {
              if (!input.idOrName) {
                const out = {
                  success: false,
                  message: "Missing 'idOrName' parameter for 'get' action.",
                }
                return { output: out, content: out.message }
              }

              const all = yield* registry.list()
              const match = all.find(
                (e) => e.id === input.idOrName || e.name.toLowerCase() === input.idOrName?.toLowerCase(),
              )

              if (!match) {
                const out = {
                  success: false,
                  message: `Extension "${input.idOrName}" not found.`,
                }
                return { output: out, content: out.message }
              }

              const out = {
                success: true,
                message: `Found extension: ${match.name}`,
                data: match,
              }
              return {
                output: out,
                content: `### Extension: ${match.name} (v${match.version})\n- Origin: ${match.originPlatform}\n- Category: ${match.category}\n- Scope: ${match.scope}\n- Status: ${match.status}\n- Description: ${match.description ?? "(none)"}`,
              }
            }

            const out = {
              success: false,
              message: `Unknown action: ${input.action}`,
            }
            return { output: out, content: out.message }
          }),
      }),
    )
  }),
}

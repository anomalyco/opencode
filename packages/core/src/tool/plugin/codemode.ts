export * as CodeModePlugin from "./codemode.js"

import type { ToolDomain } from "@opencode/plugin/effect/tool"
import { Context, Effect, Option } from "effect"
import { CodeModeAgents } from "../../codemode/agents.js"
import { CodeModeApi } from "../../codemode/api.js"
import { CodeModeTool } from "../../codemode/tool.js"
import { FileAccess } from "../../file-access.js"
import { FileMutation } from "../../file-mutation.js"
import { FileWrite } from "../../file-write.js"
import { Flag } from "../../flag.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"

/** Registers Code Mode's `execute` tool. */
export const Plugin = {
  id: "opencode.tool.codemode",
  effect: Effect.fn("CodeModePlugin")(function* (ctx: { readonly tool: ToolDomain }) {
    const flags = yield* Flag.Service
    const permission = yield* Permission.Service
    // A Location without these (as in some tests) gets Code Mode without the globals they power.
    const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
    const files = Option.getOrUndefined(
      Option.all([
        yield* Effect.serviceOption(FileAccess.Service),
        yield* Effect.serviceOption(FileMutation.Service),
        yield* Effect.serviceOption(FileWrite.Service),
      ]),
    )
    const api = Option.getOrUndefined(yield* Effect.serviceOption(CodeModeApi.Service))
    const agents = Option.getOrUndefined(yield* Effect.serviceOption(CodeModeAgents.Service))

    yield* ctx.tool
      .transform((editor) => {
        // The registry replays this transform when a flag changes.
        const enabled = flags.current()
        editor.add(
          CodeModeTool.create({
            permission,
            ...(enabled.full_codemode.enabled && location && files
              ? {
                  services: Context.make(Location.Service, location).pipe(
                    Context.add(FileAccess.Service, files[0]),
                    Context.add(FileMutation.Service, files[1]),
                    Context.add(FileWrite.Service, files[2]),
                  ),
                }
              : {}),
            ...(api && location
              ? {
                  api: Context.make(
                    CodeModeApi.Service,
                    enabled.opencode_api.enabled ? api : CodeModeApi.disabled,
                  ).pipe(Context.add(Location.Service, location)),
                }
              : {}),
            ...(enabled.codemode_agents.enabled && agents
              ? { agents: Context.make(CodeModeAgents.Service, agents) }
              : {}),
          }),
        )
      })
      .pipe(Effect.orDie)
  }),
}

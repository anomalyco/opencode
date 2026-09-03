import { Plugin } from "@opencode-ai/plugin/effect"
import { Agent } from "@opencode-ai/schema/agent"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Tool } from "@opencode-ai/schema/tool"
import { CodeModeTool } from "../../../../core/src/codemode/tool"
import { execute } from "../../../../core/src/tool/runtime"
import { Effect, Schema } from "effect"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { Smoke } from "../contract"

export default Plugin.define({
  id: "browser.smoke",
  effect: (ctx) =>
    Effect.gen(function* () {
      const tools = new Map<string, Tool.Info>()
      yield* ctx.tool
        .transform((editor) => {
          editor
            .list()
            .filter((tool) => tool.options?.namespace?.startsWith("browser"))
            .forEach((tool) => tools.set(tool.id, tool))
        })
        .pipe(Effect.orDie)
      yield* ctx.rpc
        .register(Smoke, {
          execute: (input) =>
            Effect.gen(function* () {
              const result = yield* CodeModeTool.create({ tools }, (name, tool, input, context) =>
                execute(tool, input, context),
              ).execute(
                { code: input.code },
                {
                  sessionID: input.sessionID,
                  agent: Agent.ID.make("build"),
                  messageID: SessionMessage.ID.create(),
                  id: Tool.CallID.make(crypto.randomUUID()),
                  progress: () => Effect.void,
                },
              )
              return Schema.decodeUnknownSync(
                Schema.Struct({ output: Schema.String, error: Schema.optionalKey(Schema.Boolean) }),
              )(result.output)
            }).pipe(Effect.orDie),
          write: ({ text }) =>
            Effect.promise(async () => {
              const file = path.join(process.env.SMOKE_SERVER_FILES!, "upload.txt")
              await writeFile(file, text)
              return file
            }),
          read: ({ path }) => Effect.promise(async () => (await readFile(path)).toString("base64")),
        })
        .pipe(Effect.orDie)
    }),
})

/**
 * Model-facing file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write"

import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { Bom } from "@opencode-ai/util/bom"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { FileMutation } from "../../file-mutation"
import { Formatter } from "../../formatter"
import { LocationMutation } from "../../location-mutation"
import { Permission } from "../../permission"

export const name = "write"

// TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to write. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval.",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`

/** Deferred write UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.write",
  effect: Effect.fn("WriteTool.Plugin")(function* (ctx: PluginContext) {
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const formatter = yield* Formatter.Service
    const fs = yield* FSUtil.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          ({
              name,
              options: { codemode: false, permission: "edit" },
              description:
                "Write content to one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval.",
              input: Input,
              output: Output,
              execute: (input, context) =>
                Effect.gen(function* () {
                  const source = {
                    type: "tool" as const,
                    messageID: context.messageID,
                    callID: context.callID,
                  }
                  const target = yield* mutation.resolve({ path: input.path, kind: "file" })
                  const external = target.externalDirectory
                  if (external)
                    yield* permission.assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                  yield* permission.assert({
                    action: "edit",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                  const result = yield* files.writeTextPreservingBom({ target, content: input.content })
                  const bom = (yield* Bom.readFile(fs, target.canonical)).bom
                  if (yield* formatter.file(target.canonical)) yield* Bom.syncFile(fs, target.canonical, bom)
                  return result
                }).pipe(
                  Effect.map((output) => ({ output, content: toModelOutput(output) })),
                  Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })),
                ),
            }),
        ),
      )
      .pipe(Effect.orDie)
  }),
}

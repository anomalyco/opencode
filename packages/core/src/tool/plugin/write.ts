/**
 * Model-facing file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { Bom } from "@opencode/util/bom"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { FileWrite } from "../../file-write.js"
import { Flag } from "../../flag.js"
import { fileDiff, formatterResult } from "./file-diff.js"

export const name = "write"

// TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to the file to write to",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.String
export type Output = typeof Output.Type

/** Deferred write UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.write",
  effect: Effect.fn("WriteTool.Plugin")(function* (ctx: Context) {
    const fileWrite = yield* FileWrite.Service
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: flags.resolve(loaded.entries).full_codemode.enabled
            ? {
                codemode: {
                  pinned: true,
                  description:
                    "Create a new file or overwrite an existing file on the local filesystem, creating missing parent directories automatically. Prefer `edit` for partial changes to existing files.",
                },
                permission: "edit",
              }
            : { codemode: false, permission: "edit" },
          description:
            "Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            fileWrite.write(input, context).pipe(
              Effect.map((written) => {
                const before = Bom.split(input.content).text
                const changes =
                  written.formatted !== undefined && written.formatted !== before
                    ? [fileDiff(written.resource, before, written.formatted)]
                    : []
                const message = `${written.existed ? "Wrote" : "Created"} file successfully: ${written.resource}`
                return {
                  output: message,
                  content: [{ type: "text" as const, text: message }, ...formatterResult(changes)],
                }
              }),
              Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

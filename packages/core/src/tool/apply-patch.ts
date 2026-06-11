export * as ApplyPatchTool from "./apply-patch"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { Patch } from "../patch"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "apply_patch"

export const Input = Schema.Struct({
  patchText: Schema.String.annotate({
    description: "The full patch text describing add, update, and delete operations",
  }),
})

export const Applied = Schema.Struct({
  type: Schema.Literals(["add", "update", "delete"]),
  resource: Schema.String,
  target: Schema.String,
})

export const Output = Schema.Struct({ applied: Schema.Array(Applied) })
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  [
    "Applied patch sequentially:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
  ].join("\n")

type Prepared =
  | (Extract<Patch.Hunk, { readonly type: "add" | "delete" }> & { readonly target: LocationMutation.Target })
  | (Extract<Patch.Hunk, { readonly type: "update" }> & {
      readonly target: LocationMutation.Target
      readonly source: Uint8Array
      readonly content: string
    })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Apply one patch containing add, update, and delete file operations. All targets are resolved and approved before target contents are read. Operations apply sequentially; if a later operation fails, earlier operations remain applied and the failure reports them explicitly. Moves and atomic rollback are not supported yet.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
            execute: (input, context) => {
              const applied: Array<typeof Applied.Type> = []
              const fail = (path: string) => {
                const prefix =
                  applied.length === 0
                    ? `Unable to apply patch at ${path}`
                    : `Patch partially applied before failing at ${path}. Applied: ${applied.map((item) => item.resource).join(", ")}`
                return new ToolFailure({ message: prefix })
              }
              return Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                if (!input.patchText.trim()) return yield* new ToolFailure({ message: "patchText is required" })
                const hunks = yield* Effect.try({
                  try: () => Patch.parse(input.patchText),
                  catch: (cause) => new ToolFailure({ message: `apply_patch verification failed: ${String(cause)}` }),
                })
                if (hunks.length === 0) return yield* new ToolFailure({ message: "patch rejected: empty patch" })
                const move = hunks.find((hunk) => hunk.type === "update" && hunk.movePath !== undefined)
                if (move) return yield* new ToolFailure({ message: "apply_patch moves are not supported yet" })

                const targets: Array<{ readonly hunk: Patch.Hunk; readonly target: LocationMutation.Target }> = []
                for (const hunk of hunks)
                  targets.push({ hunk, target: yield* mutation.resolve({ path: hunk.path, kind: "file" }) })
                const externalDirectories = new Map<string, LocationMutation.ExternalDirectoryAuthorization>()
                for (const { target } of targets) {
                  const external = target.externalDirectory
                  if (external) externalDirectories.set(external.resource, external)
                }
                for (const external of externalDirectories.values()) {
                  yield* permission.assert({
                    ...LocationMutation.externalDirectoryPermission(external),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                }
                yield* permission.assert({
                  action: "edit",
                  resources: [...new Set(targets.map(({ target }) => target.resource))],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })

                const prepared: Prepared[] = []
                for (const { hunk, target } of targets) {
                  yield* Effect.gen(function* () {
                    if (hunk.type === "add") {
                      prepared.push({ ...hunk, target })
                      return
                    }
                    if ((yield* fs.stat(target.canonical)).type !== "File") yield* fail(hunk.path)
                    if (hunk.type === "delete") {
                      prepared.push({ ...hunk, target })
                      return
                    }
                    const source = yield* fs.readFile(target.canonical)
                    const update = Patch.derive(
                      hunk.path,
                      hunk.chunks,
                      new TextDecoder("utf-8", { ignoreBOM: true }).decode(source),
                    )
                    prepared.push({
                      ...hunk,
                      target,
                      source,
                      content: Patch.joinBom(update.content, update.bom),
                    })
                  }).pipe(Effect.mapError(() => fail(hunk.path)))
                }

                yield* Effect.forEach(
                  prepared,
                  (change) =>
                    Effect.gen(function* () {
                      if (change.type === "add") {
                        const result = yield* files.create({
                          target: change.target,
                          content:
                            change.contents.endsWith("\n") || change.contents === ""
                              ? change.contents
                              : `${change.contents}\n`,
                        })
                        applied.push({ type: change.type, resource: result.resource, target: result.target })
                        return
                      }
                      if (change.type === "delete") {
                        const result = yield* files.remove({ target: change.target })
                        applied.push({ type: change.type, resource: result.resource, target: result.target })
                        return
                      }
                      const result = yield* files.writeIfUnchanged({
                        target: change.target,
                        expected: change.source,
                        content: change.content,
                      })
                      applied.push({ type: change.type, resource: result.resource, target: result.target })
                    }).pipe(Effect.mapError(() => fail(change.path))),
                  { discard: true },
                )
                return { applied }
              }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("patch"))))
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

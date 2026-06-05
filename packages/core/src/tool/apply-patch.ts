export * as ApplyPatchTool from "./apply-patch"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { Patch } from "../patch"
import { ToolRegistry } from "./registry"

export const name = "apply_patch"

export const Parameters = Schema.Struct({
  patchText: Schema.String.annotate({
    description: "The full patch text describing add, update, and delete operations",
  }),
})

export const Applied = Schema.Struct({
  type: Schema.Literals(["add", "update", "delete"]),
  resource: Schema.String,
  target: Schema.String,
})

export const Success = Schema.Struct({ applied: Schema.Array(Applied) })
export type Success = typeof Success.Type

export const toModelOutput = (output: Success) =>
  [
    "Applied patch sequentially:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
  ].join("\n")

const definition = Tool.make({
  description:
    "Apply one patch containing add, update, and delete file operations. All targets are resolved and approved before target contents are read. Operations apply sequentially; if a later operation fails, earlier operations remain applied and the failure reports them explicitly. Moves and atomic rollback are not supported yet.",
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
})

type Planned = { readonly hunk: Patch.Hunk; readonly plan: LocationMutation.Plan }
type Prepared =
  | {
      readonly type: "add"
      readonly hunk: Extract<Patch.Hunk, { readonly type: "add" }>
      readonly plan: LocationMutation.Plan
    }
  | {
      readonly type: "delete"
      readonly hunk: Extract<Patch.Hunk, { readonly type: "delete" }>
      readonly plan: LocationMutation.Plan
    }
  | {
      readonly type: "update"
      readonly hunk: Extract<Patch.Hunk, { readonly type: "update" }>
      readonly plan: LocationMutation.Plan
      readonly source: Uint8Array
      readonly content: string
    }

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, assertPermission }) => {
          const applied: Array<typeof Applied.Type> = []
          const fail = (path: string, cause: unknown) => {
            const prefix =
              applied.length === 0
                ? `Unable to apply patch at ${path}`
                : `Patch partially applied before failing at ${path}. Applied: ${applied.map((item) => item.resource).join(", ")}`
            return new ToolFailure({ message: prefix, error: cause })
          }
          return Effect.gen(function* () {
            if (!parameters.patchText.trim()) return yield* new ToolFailure({ message: "patchText is required" })
            const hunks = yield* Effect.try({
              try: () => Patch.parse(parameters.patchText),
              catch: (cause) => new ToolFailure({ message: `apply_patch verification failed: ${String(cause)}` }),
            })
            if (hunks.length === 0) return yield* new ToolFailure({ message: "patch rejected: empty patch" })
            const move = hunks.find((hunk) => hunk.type === "update" && hunk.movePath !== undefined)
            if (move) return yield* new ToolFailure({ message: "apply_patch moves are not supported yet" })

            const planned: Planned[] = []
            for (const hunk of hunks)
              planned.push({ hunk, plan: yield* mutation.resolve({ path: hunk.path, kind: "file" }) })
            const externalDirectories = new Map<string, LocationMutation.ExternalDirectoryAuthorization>()
            for (const { plan } of planned) {
              const external = plan.target.externalDirectory
              if (external) externalDirectories.set(external.resource, external)
            }
            for (const external of externalDirectories.values()) {
              yield* assertPermission(LocationMutation.externalDirectoryPermission(external))
            }
            yield* assertPermission({
              action: "edit",
              resources: [...new Set(planned.map(({ plan }) => plan.target.resource))],
              save: ["*"],
            })

            const prepared: Prepared[] = []
            for (const { hunk, plan } of planned) {
              if (hunk.type === "add") {
                const target = yield* mutation.revalidate(plan)
                if (target.exists) return yield* fail(hunk.path, new Error("Target file already exists"))
                prepared.push({ type: hunk.type, hunk, plan })
                continue
              }
              const target = yield* mutation.revalidate(plan)
              if (!target.exists || target.type !== "File")
                return yield* fail(hunk.path, new Error("Target file does not exist"))
              if (hunk.type === "delete") {
                prepared.push({ type: hunk.type, hunk, plan })
                continue
              }
              const source = yield* fs.readFile(target.canonical)
              const update = Patch.derive(
                hunk.path,
                hunk.chunks,
                new TextDecoder("utf-8", { ignoreBOM: true }).decode(source),
              )
              prepared.push({ type: hunk.type, hunk, plan, source, content: Patch.joinBom(update.content, update.bom) })
            }

            yield* Effect.uninterruptible(
              Effect.forEach(
                prepared,
                (change) =>
                  Effect.gen(function* () {
                    if (change.type === "add") {
                      const result = yield* files.create({
                        plan: change.plan,
                        content:
                          change.hunk.contents.endsWith("\n") || change.hunk.contents === ""
                            ? change.hunk.contents
                            : `${change.hunk.contents}\n`,
                      })
                      applied.push({ type: change.type, resource: result.resource, target: result.target })
                      return
                    }
                    if (change.type === "delete") {
                      const result = yield* files.remove({ plan: change.plan })
                      applied.push({ type: change.type, resource: result.resource, target: result.target })
                      return
                    }
                    const result = yield* files.writeIfUnchanged({
                      plan: change.plan,
                      expected: change.source,
                      content: change.content,
                    })
                    applied.push({ type: change.type, resource: result.resource, target: result.target })
                  }).pipe(Effect.catchCause((cause) => Effect.fail(fail(change.hunk.path, Cause.squash(cause))))),
                { discard: true },
              ),
            )
            return { applied }
          }).pipe(
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause)
              return Effect.fail(error instanceof ToolFailure ? error : fail("patch", error))
            }),
          )
        },
      }),
    )
  }),
)

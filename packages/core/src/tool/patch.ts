export * as PatchTool from "./patch"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/llm"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Schema } from "effect"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { Patch } from "../patch"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"

export const name = "patch"

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

export const Output = Schema.Struct({
  applied: Schema.Array(Applied),
  files: Schema.Array(FileDiff.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  [
    "Applied patch sequentially:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
  ].join("\n")

type Prepared =
  | (Extract<Patch.Hunk, { readonly type: "add" | "delete" }> & {
      readonly target: LocationMutation.Target
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "update" }> & {
      readonly target: LocationMutation.Target
      readonly source: Uint8Array
      readonly content: string
      readonly before: string
      readonly after: string
    })

export const Plugin = {
  id: "opencode.tool.patch",
  effect: Effect.fn("PatchTool.Plugin")(function* (ctx: PluginContext) {
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.withPermission(
            Tool.make({
              description:
                "Apply one patch containing add, update, and delete file operations. All targets are resolved and approved before target contents are read. Operations apply sequentially; if a later operation fails, earlier operations remain applied and the failure reports them explicitly. Moves and atomic rollback are not supported yet.",
              input: Input,
              output: Output,
              toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
              execute: (input, context) => {
                const applied: Array<typeof Applied.Type> = []
                const fail = (path: string, error?: unknown) => {
                  const prefix =
                    applied.length === 0
                      ? `Unable to apply patch at ${path}`
                      : `Patch partially applied before failing at ${path}. Applied: ${applied.map((item) => item.resource).join(", ")}`
                  return new ToolFailure({ message: prefix, error })
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
                    catch: (cause) => new ToolFailure({ message: `patch verification failed: ${String(cause)}` }),
                  })
                  if (hunks.length === 0) return yield* new ToolFailure({ message: "patch rejected: empty patch" })
                  const move = hunks.find((hunk) => hunk.type === "update" && hunk.movePath !== undefined)
                  if (move) return yield* new ToolFailure({ message: "patch moves are not supported yet" })

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
                        prepared.push({
                          ...hunk,
                          target,
                          before: "",
                          after:
                            hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`,
                        })
                        return
                      }
                      if ((yield* fs.stat(target.canonical)).type !== "File") yield* fail(hunk.path)
                      const source = yield* fs.readFile(target.canonical)
                      const original = new TextDecoder("utf-8", { ignoreBOM: true }).decode(source)
                      const before = original.replace(/^\uFEFF/, "")
                      if (hunk.type === "delete") {
                        prepared.push({ ...hunk, target, before, after: "" })
                        return
                      }
                      const update = Patch.derive(hunk.path, hunk.chunks, original)
                      prepared.push({
                        ...hunk,
                        target,
                        source,
                        content: Patch.joinBom(update.content, update.bom),
                        before,
                        after: update.content,
                      })
                    }).pipe(Effect.mapError((error) => fail(hunk.path, error)))
                  }

                  const patchFiles = prepared.map(patchFile)
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
                      }).pipe(Effect.mapError((error) => fail(change.path, error))),
                    { discard: true },
                  )
                  return { applied, files: patchFiles }
                }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("patch", error))))
              },
            }),
            "edit",
          ),
        ),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("request", (event) =>
      Effect.sync(() => {
        const usePatch =
          event.model.providerID.toLowerCase() === "openai" || event.model.id.toLowerCase().includes("gpt")
        if (usePatch) {
          delete event.tools.edit
          delete event.tools.write
          return
        }
        delete event.tools.patch
      }),
    )
  }),
}

function patchFile(change: Prepared): typeof FileDiff.Info.Type {
  const counts = diffLines(change.before, change.after).reduce(
    (result, item) => ({
      additions: result.additions + (item.added ? (item.count ?? 0) : 0),
      deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
    }),
    { additions: 0, deletions: 0 },
  )
  return {
    file: change.target.resource,
    patch: createTwoFilesPatch(change.target.resource, change.target.resource, change.before, change.after),
    status: change.type === "add" ? "added" : change.type === "delete" ? "deleted" : "modified",
    ...counts,
  }
}

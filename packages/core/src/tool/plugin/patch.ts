export * as PatchTool from "./patch"

import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Schema } from "effect"
import { PlatformError } from "effect/PlatformError"
import { FileMutation } from "../../file-mutation"
import { LocationMutation } from "../../location-mutation"
import { Patch } from "@opencode-ai/util/patch"
import { Permission } from "../../permission"
import DESCRIPTION from "../patch.txt"

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
    "Success. Updated the following files:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
  ].join("\n")

type Prepared =
  | (Extract<Patch.Hunk, { readonly type: "add" | "delete" }> & {
      readonly target: Target
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "update" }> & {
      readonly target: Target
      readonly content: string
      readonly before: string
      readonly after: string
      readonly moveTarget?: Target
    })

type Target = LocationMutation.Target

export const Plugin = {
  id: "opencode.tool.patch",
  effect: Effect.fn("PatchTool.Plugin")(function* (ctx: PluginContext) {
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false, permission: "edit" },
          description: DESCRIPTION,
          input: Input,
          output: Output,
          execute: (input, context) => {
            const applied: Array<typeof Applied.Type> = []
            const fail = (operation: string, error: unknown) => {
              const completed = applied.map((item) => item.resource).join(", ")
              return new ToolFailure({
                message: `${operation}: ${errorMessage(error)}${completed ? `. Completed before failure: ${completed}` : ""}`,
              })
            }
            return Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              if (!input.patchText) return yield* new ToolFailure({ message: "patchText is required" })
              const hunks = yield* Effect.fromResult(Patch.parse(input.patchText)).pipe(
                Effect.mapError((error) => new ToolFailure({ message: `patch verification failed: ${error.message}` })),
              )
              if (hunks.length === 0) {
                return yield* new ToolFailure({ message: "patch rejected: empty patch" })
              }
              const prepared: Prepared[] = []
              const targets: Target[] = []
              const updates = new Map<string, string>()
              const resolveHunkTarget = (value: string) =>
                mutation
                  .resolve({ path: value, kind: "file" })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` }),
                    ),
                  )
              for (const hunk of hunks) {
                yield* Effect.gen(function* () {
                  const target = yield* resolveHunkTarget(hunk.path)
                  targets.push(target)
                  if (target.externalDirectory) {
                    yield* permission.assert({
                      ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                  }
                  if (hunk.type === "add") {
                    const contents =
                      hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`
                    prepared.push({
                      ...hunk,
                      contents,
                      target,
                      before: "",
                      after: FileMutation.normalizeText(contents),
                    })
                    return
                  }
                  if (hunk.type === "delete") {
                    const content = yield* files.read(target).pipe(
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({
                            message: `patch verification failed: Failed to delete ${target.resource}: ${errorMessage(error)}`,
                          }),
                      ),
                    )
                    prepared.push({ ...hunk, target, before: content, after: "" })
                    return
                  }
                  const previous = updates.get(target.canonical)
                  const original =
                    previous ??
                    (yield* files.read(target).pipe(
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({
                            message: `patch verification failed: Failed to read file to update ${target.canonical}: ${errorMessage(error)}`,
                          }),
                      ),
                    ))
                  const update = yield* Effect.try({
                    try: () => Patch.derive(hunk.path, hunk.chunks, original),
                    catch: (error) => new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` }),
                  })
                  const content = FileMutation.normalizeText(update.content)
                  const moveTarget = hunk.movePath ? yield* resolveHunkTarget(hunk.movePath) : undefined
                  if (moveTarget) targets.push(moveTarget)
                  if (moveTarget?.externalDirectory) {
                    yield* permission.assert({
                      ...LocationMutation.externalDirectoryPermission(moveTarget.externalDirectory),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                  }
                  prepared.push({
                    ...hunk,
                    target,
                    content: Patch.joinBom(update.content, update.bom),
                    before: original,
                    after: content,
                    moveTarget,
                  })
                  if (!moveTarget) updates.set(target.canonical, content)
                }).pipe(
                  Effect.mapError((error) =>
                    error instanceof ToolFailure
                      ? error
                      : new ToolFailure({ message: `Unable to prepare patch at ${hunk.path}`, error }),
                  ),
                )
              }

              const patchFiles = prepared.map((change) => patchFile(change))
              yield* permission.assert({
                action: "edit",
                resources: [...new Set(targets.map((target) => target.resource))],
                save: ["*"],
                metadata: {
                  filepath: targets.map((target) => target.resource).join(", "),
                  diff: patchFiles.map((file) => `${file.patch}\n`).join(""),
                  files: patchFiles,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              // FileMutation.write formats where the files live and reports
              // the final text, so the diff output reflects disk.
              const formatted = new Map<string, string>()
              yield* Effect.forEach(
                prepared,
                (change) =>
                  Effect.gen(function* () {
                    if (change.type === "add") {
                      const result = yield* files
                        .write({ target: change.target, content: change.contents })
                        .pipe(Effect.mapError((error) => fail(`Failed to write ${change.target.resource}`, error)))
                      formatted.set(change.target.canonical, result.content)
                      applied.push({
                        type: change.type,
                        resource: change.target.resource,
                        target: change.target.canonical,
                      })
                      return
                    }
                    if (change.type === "delete") {
                      yield* files
                        .remove(change.target)
                        .pipe(Effect.mapError((error) => fail(`Failed to delete ${change.target.resource}`, error)))
                      applied.push({
                        type: change.type,
                        resource: change.target.resource,
                        target: change.target.canonical,
                      })
                      return
                    }
                    if (change.moveTarget) {
                      const moveTarget = change.moveTarget
                      const result = yield* files
                        .move({ from: change.target, to: moveTarget, content: change.content })
                        .pipe(
                          Effect.mapError((error) =>
                            error instanceof FileMutation.MoveIncompleteError
                              ? fail(
                                  `Wrote ${moveTarget.resource} but failed to remove ${change.target.resource}`,
                                  error.cause,
                                )
                              : fail(`Failed to write ${moveTarget.resource}`, error),
                          ),
                        )
                      formatted.set(moveTarget.canonical, result.content)
                      applied.push({
                        type: change.type,
                        resource: change.moveTarget.resource,
                        target: change.moveTarget.canonical,
                      })
                      return
                    }
                    const result = yield* files
                      .write({ target: change.target, content: change.content })
                      .pipe(Effect.mapError((error) => fail(`Failed to write ${change.target.resource}`, error)))
                    formatted.set(change.target.canonical, result.content)
                    applied.push({
                      type: change.type,
                      resource: change.target.resource,
                      target: change.target.canonical,
                    })
                  }),
                { discard: true },
              )
              const fileDiffs = yield* Effect.forEach(prepared, (change) => {
                if (change.type === "delete") return Effect.succeed(patchFile(change))
                const target = change.type === "update" && change.moveTarget ? change.moveTarget : change.target
                return Effect.succeed(patchFile(change, formatted.get(target.canonical)))
              })
              return { applied, files: fileDiffs }
            }).pipe(
              Effect.map((output) => ({
                output,
                content: toModelOutput(output),
                metadata: { files: output.files },
              })),
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to apply patch", error }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        const usePatch =
          event.model.id.includes("gpt-") && !event.model.id.includes("oss") && !event.model.id.includes("gpt-4")
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
function errorMessage(error: unknown) {
  if (error instanceof FileMutation.NotFoundError) return "file does not exist"
  if (error instanceof FileMutation.NotAFileError) return "path is a directory"
  if (error instanceof LocationMutation.PathError)
    return error.reason === "outside_workspace"
      ? `path is outside the workspace: ${error.path}`
      : `ancestor is not a directory: ${error.path}`
  if (error instanceof PlatformError) {
    if (error.reason._tag === "NotFound") return "file does not exist"
    return error.reason.description ?? error.reason.message
  }
  return error instanceof Error ? error.message : String(error)
}

function patchFile(change: Prepared, after = change.after): typeof FileDiff.Info.Type {
  const target = (change.type === "update" ? change.moveTarget : undefined)?.resource ?? change.target.resource
  const patch = trimDiff(createTwoFilesPatch(change.target.canonical, change.target.canonical, change.before, after))
  const counts =
    change.type === "delete"
      ? { additions: 0, deletions: change.before.split("\n").length }
      : diffLines(change.before, after).reduce(
          (result, item) => ({
            additions: result.additions + (item.added ? (item.count ?? 0) : 0),
            deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
          }),
          { additions: 0, deletions: 0 },
        )
  return {
    file: target,
    patch,
    status: change.type === "add" ? "added" : change.type === "delete" ? "deleted" : "modified",
    ...counts,
  }
}

function trimDiff(diff: string) {
  const lines = diff.split("\n")
  const content = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )
  if (content.length === 0) return diff
  const indent = content.reduce((result, line) => {
    const value = line.slice(1)
    if (value.trim().length === 0) return result
    return Math.min(result, value.match(/^(\s*)/)?.[1].length ?? result)
  }, Infinity)
  if (indent === Infinity || indent === 0) return diff
  return lines
    .map((line) => {
      if (
        (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
        !line.startsWith("---") &&
        !line.startsWith("+++")
      ) {
        return line[0] + line.slice(1 + indent)
      }
      return line
    })
    .join("\n")
}

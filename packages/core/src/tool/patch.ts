export * as PatchTool from "./patch"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Schema } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Patch } from "../patch"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import DESCRIPTION from "./patch.txt"

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

interface Target {
  readonly canonical: string
  readonly resource: string
  readonly externalDirectory?: {
    readonly directory: string
    readonly resource: string
  }
}

export const Plugin = {
  id: "opencode.tool.patch",
  effect: Effect.fn("PatchTool.Plugin")(function* (ctx: PluginContext) {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.withPermission(
            Tool.make({
              description: DESCRIPTION,
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
                    messageID: context.messageID,
                    callID: context.callID,
                  }
                  if (!input.patchText) return yield* new ToolFailure({ message: "patchText is required" })
                  const hunks = yield* Effect.try({
                    try: () => Patch.parse(input.patchText),
                    catch: (cause) => new ToolFailure({ message: `patch verification failed: ${String(cause)}` }),
                  })
                  if (hunks.length === 0) {
                    const normalized = input.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
                    if (normalized === "*** Begin Patch\n*** End Patch") {
                      return yield* new ToolFailure({ message: "patch rejected: empty patch" })
                    }
                    return yield* new ToolFailure({ message: "patch verification failed: no hunks found" })
                  }
                  const prepared: Prepared[] = []
                  const targets: Target[] = []
                  for (const hunk of hunks) {
                    yield* Effect.gen(function* () {
                      const target = resolveTarget(location, hunk.path)
                      targets.push(target)
                      if (target.externalDirectory) {
                        yield* permission.assert({
                          action: "external_directory",
                          resources: [target.externalDirectory.resource],
                          save: [target.externalDirectory.resource],
                          metadata: {
                            filepath: target.canonical,
                            parentDir: target.externalDirectory.directory,
                          },
                          sessionID: context.sessionID,
                          agent: context.agent,
                          source,
                        })
                      }
                      if (hunk.type === "add") {
                        prepared.push({
                          ...hunk,
                          target,
                          before: "",
                          after: (hunk.contents.endsWith("\n") || hunk.contents === ""
                            ? hunk.contents
                            : `${hunk.contents}\n`
                          ).replace(/^\uFEFF/, ""),
                        })
                        return
                      }
                      if (hunk.type === "delete") {
                        const content = yield* fs.readFile(target.canonical).pipe(
                          Effect.mapError(
                            (error) =>
                              new ToolFailure({
                                message: `patch verification failed: ${error instanceof Error ? error.message : String(error)}`,
                              }),
                          ),
                        )
                        const original = new TextDecoder("utf-8", { ignoreBOM: true }).decode(content)
                        prepared.push({ ...hunk, target, before: original.replace(/^\uFEFF/, ""), after: "" })
                        return
                      }
                      const stats = yield* fs
                        .stat(target.canonical)
                        .pipe(Effect.catch(() => Effect.succeed(undefined)))
                      if (!stats || stats.type === "Directory") {
                        return yield* new ToolFailure({
                          message: `patch verification failed: Failed to read file to update: ${target.canonical}`,
                        })
                      }
                      const content = yield* fs.readFile(target.canonical)
                      const original = new TextDecoder("utf-8", { ignoreBOM: true }).decode(content)
                      const before = original.replace(/^\uFEFF/, "")
                      const update = yield* Effect.try({
                        try: () => Patch.derive(hunk.path, hunk.chunks, original),
                        catch: (error) =>
                          new ToolFailure({ message: `patch verification failed: ${String(error)}` }),
                      })
                      const moveTarget = hunk.movePath ? resolveTarget(location, hunk.movePath) : undefined
                      if (moveTarget?.externalDirectory) {
                        yield* permission.assert({
                          action: "external_directory",
                          resources: [moveTarget.externalDirectory.resource],
                          save: [moveTarget.externalDirectory.resource],
                          metadata: {
                            filepath: moveTarget.canonical,
                            parentDir: moveTarget.externalDirectory.directory,
                          },
                          sessionID: context.sessionID,
                          agent: context.agent,
                          source,
                        })
                      }
                      prepared.push({
                        ...hunk,
                        target,
                        content: Patch.joinBom(update.content, update.bom),
                        before,
                        after: update.content,
                        moveTarget,
                      })
                    }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail(hunk.path, error))))
                  }

                  const patchFiles = prepared.map(patchFile)
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

                  yield* Effect.forEach(
                    prepared,
                    (change) =>
                      Effect.gen(function* () {
                        if (change.type === "add") {
                          yield* fs.writeWithDirs(
                            change.target.canonical,
                            change.contents.endsWith("\n") || change.contents === ""
                              ? change.contents
                              : `${change.contents}\n`,
                          )
                          applied.push({
                            type: change.type,
                            resource: change.target.resource,
                            target: change.target.canonical,
                          })
                          return
                        }
                        if (change.type === "delete") {
                          yield* fs.remove(change.target.canonical)
                          applied.push({
                            type: change.type,
                            resource: change.target.resource,
                            target: change.target.canonical,
                          })
                          return
                        }
                        if (change.moveTarget) {
                          yield* fs.writeWithDirs(change.moveTarget.canonical, change.content)
                          yield* fs.remove(change.target.canonical)
                          applied.push({
                            type: change.type,
                            resource: change.moveTarget.resource,
                            target: change.moveTarget.canonical,
                          })
                          return
                        }
                        yield* fs.writeWithDirs(change.target.canonical, change.content)
                        applied.push({
                          type: change.type,
                          resource: change.target.resource,
                          target: change.target.canonical,
                        })
                      }).pipe(Effect.mapError((error) => fail(change.path, error))),
                    { discard: true },
                  )
                  return { applied, files: patchFiles }
                }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("patch", error))))
              },
            }),
            "edit",
          ),
          { codemode: false },
        ),
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

function patchFile(change: Prepared): typeof FileDiff.Info.Type {
  const target = (change.type === "update" ? change.moveTarget : undefined)?.resource ?? change.target.resource
  const patch = trimDiff(
    createTwoFilesPatch(change.target.canonical, change.target.canonical, change.before, change.after),
  )
  const counts =
    change.type === "delete"
      ? { additions: 0, deletions: change.before.split("\n").length }
      : diffLines(change.before, change.after).reduce(
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

function resolveTarget(location: Location.Interface, value: string): Target {
  const canonical =
    process.platform === "win32"
      ? FSUtil.normalizePath(path.resolve(location.directory, value))
      : path.resolve(location.directory, value)
  const projectRoot = path.parse(location.project.directory).root
  const external =
    !FSUtil.contains(location.directory, canonical) &&
    (location.project.directory === projectRoot || !FSUtil.contains(location.project.directory, canonical))
  const directory = path.dirname(canonical)
  const resource =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(directory, "*"))
      : path.join(directory, "*").replaceAll("\\", "/")
  return {
    canonical,
    resource: path.relative(location.project.directory, canonical).replaceAll("\\", "/") || ".",
    externalDirectory: external ? { directory, resource } : undefined,
  }
}

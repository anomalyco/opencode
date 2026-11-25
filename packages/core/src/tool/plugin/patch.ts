export * as PatchTool from "./patch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { FileDiff } from "@opencode/schema/file-diff"
import { Effect, Result, Schema } from "effect"
import { Bom } from "@opencode/util/bom"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { toolFailure } from "../runtime.js"
import { Environment } from "../../environment/index.js"
import { Formatter } from "../../formatter.js"
import { FileMutation } from "../../file-mutation.js"
import { FileWrite } from "../../file-write.js"
import { FileAccess } from "../../file-access.js"
import { Patch } from "@opencode/util/patch"
import { Permission } from "../../permission.js"
import DESCRIPTION from "../patch.txt"
import GRAMMAR from "../patch-grammar.txt"
import { fileDiff } from "./file-diff.js"

export const name = "patch"

export const Input = Schema.Struct({
  patchText: Schema.String.annotate({
    description: "The full patch text describing add, update, and delete operations",
  }),
})

export const Output = Schema.Record(Schema.String, Schema.Never)

type Prepared =
  | (Extract<Patch.Hunk, { readonly type: "add" }> & {
      readonly target: FileAccess.Target
      readonly content: string
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "delete" }> & {
      readonly target: FileAccess.Target
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "update" }> & {
      readonly target: FileAccess.Target
      readonly content: string
      readonly before: string
      readonly after: string
      readonly moveTarget?: FileAccess.Target
    })

export const Plugin = {
  id: "opencode.tool.patch",
  effect: Effect.fn("PatchTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const fileWrite = yield* FileWrite.Service
    const formatter = yield* Formatter.Service
    const permission = yield* Permission.Service
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
                    "Apply multi-file edits inside `*** Begin Patch` ... `*** End Patch`. Start each operation with `*** Add File: <path>` (every content line prefixed with `+`), `*** Delete File: <path>`, or `*** Update File: <path>` (optional `*** Move to: <path>`, then `@@ [context]` hunks with space/`-`/`+` line prefixes).",
                },
                permission: "edit",
              }
            : { codemode: false, permission: "edit" },
          description: DESCRIPTION,
          input: Input,
          freeform: { type: "lark", grammar: GRAMMAR },
          output: Output,
          execute: (input, context) => {
            const completed: string[] = []
            const parsed = Patch.parse(input.patchText)
            // The lock is taken before any path resolves, because resolving asks for approval one hunk at a time.
            // The lock locates each typed path, so one that names a machine locks on that machine.
            const lockTargets = Result.isSuccess(parsed)
              ? parsed.success.flatMap((hunk) => [
                  hunk.path,
                  ...(hunk.type === "update" && hunk.movePath ? [hunk.movePath] : []),
                ])
              : []
            const fail = (operation: string, error: unknown) => {
              return new ToolFailure({
                message: `${operation}: ${errorMessage(error)}${completed.length ? `. Completed before failure: ${completed.join(", ")}` : ""}`,
              })
            }
            const stock = Effect.gen(function* () {
              if (!input.patchText) return yield* new ToolFailure({ message: "patchText is required" })
              const hunks = yield* Effect.fromResult(parsed).pipe(
                Effect.mapError((error) => new ToolFailure({ message: `patch verification failed: ${error.message}` })),
              )
              if (hunks.length === 0) {
                return yield* new ToolFailure({ message: "patch rejected: empty patch" })
              }
              const prepared: Prepared[] = []
              const updates = new Map<string, { target: FileAccess.Target; content: string | null }>()
              const resolveTarget = Effect.fnUntraced(function* (value: string) {
                const target = yield* access.resolve({ path: value, kind: "file" })
                // The stock path uses pathname IO. A managed physical member takes the guarded add/update route below;
                // delete, move, and mixed patches remain unavailable there.
                if ((yield* access.scope(target, context, "write")).workspace)
                  return yield* new Environment.Failed({
                    path: target.absolute,
                    cause: "Scoped patch mutation is unsupported",
                  })
                if (!target.externalDirectory) return target
                yield* access.authorizeExternal([target], context, {
                  filepath: target.absolute,
                  parentDir: target.externalDirectory.directory,
                })
                return target
              })
              for (const hunk of hunks) {
                yield* Effect.gen(function* () {
                  const target = yield* resolveTarget(hunk.path)
                  const file = FileAccess.key(target)
                  if (hunk.type === "add") {
                    const content =
                      hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`
                    prepared.push({
                      ...hunk,
                      target,
                      content,
                      before: "",
                      after: Bom.split(content).text,
                    })
                    updates.set(file, { target, content })
                    return
                  }
                  if (hunk.type === "delete") {
                    const previous = updates.get(file)?.content
                    if (previous === null) {
                      return yield* new ToolFailure({
                        message: `patch verification failed: Failed to delete ${target.resource}: file does not exist`,
                      })
                    }
                    const before =
                      previous !== undefined
                        ? Bom.split(previous).text
                        : (yield* FileMutation.readText(target.environment.files, target.absolute).pipe(
                            Effect.mapError(
                              (error) =>
                                new ToolFailure({
                                  message: `patch verification failed: Failed to delete ${target.resource}: ${errorMessage(error)}`,
                                }),
                            ),
                          )).text
                    prepared.push({ ...hunk, target, before, after: "" })
                    updates.set(file, { target, content: null })
                    return
                  }
                  const previous = updates.get(file)?.content
                  if (previous === null) {
                    return yield* new ToolFailure({
                      message: `patch verification failed: Failed to read file to update ${target.absolute}: file does not exist`,
                    })
                  }
                  const original =
                    previous ??
                    (yield* Effect.gen(function* () {
                      const content = yield* FileMutation.readEditableText(
                        target.environment.files,
                        target.absolute,
                      ).pipe(
                        Effect.mapError(
                          (error) =>
                            new ToolFailure({
                              message: `patch verification failed: Failed to read file to update ${target.absolute}: ${errorMessage(error)}`,
                            }),
                        ),
                      )
                      return Bom.join(content.text, content.bom)
                    }))
                  const before = Bom.split(original).text
                  const update = yield* Effect.try({
                    try: () => Patch.derive(hunk.path, hunk.chunks, original),
                    catch: (error) => new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` }),
                  })
                  const move = hunk.movePath ? yield* resolveTarget(hunk.movePath) : undefined
                  const moveTarget = move && FileAccess.key(move) !== file ? move : undefined
                  const next = Patch.joinBom(update.content, update.bom)
                  prepared.push({
                    ...hunk,
                    target,
                    content: next,
                    before,
                    after: update.content,
                    moveTarget,
                  })
                  if (moveTarget) {
                    updates.set(file, { target, content: null })
                    updates.set(FileAccess.key(moveTarget), { target: moveTarget, content: next })
                  } else {
                    updates.set(file, { target, content: next })
                  }
                }).pipe(Effect.mapError(toolFailure(`Unable to prepare patch at ${hunk.path}`)))
              }

              const patchFiles = prepared.map((change) => patchFile(change))
              const targets = prepared.flatMap((change) => [
                change.target,
                ...(change.type === "update" && change.moveTarget ? [change.moveTarget] : []),
              ])
              yield* permission.assert({
                action: "edit",
                resources: [...new Set(targets.map((target) => target.resource))],
                save: [...new Set(targets.map(FileAccess.always))],
                metadata: {
                  filepath: targets.map((target) => target.resource).join(", "),
                  diff: patchFiles.map((file) => `${file.patch}\n`).join(""),
                  files: patchFiles,
                },
                ...Permission.invocation(context),
              })

              yield* Effect.forEach(
                prepared,
                (change) =>
                  Effect.gen(function* () {
                    const moveTarget = change.type === "update" ? change.moveTarget : undefined
                    const target = moveTarget ?? change.target
                    // On macOS and Windows a move that only changes case targets the same file, so the new name already
                    // exists, and writing it then removing the old one would delete the file. Such a move writes in
                    // place and renames. Symlinks keep the write-and-remove path, which leaves their target alone.
                    // The same path in another environment is another file, so a move there is never a rename.
                    const recased =
                      moveTarget !== undefined &&
                      moveTarget.environment.id === change.target.environment.id &&
                      moveTarget.absolute.toLowerCase() === change.target.absolute.toLowerCase() &&
                      (yield* change.target.environment.files.stat(change.target.absolute).pipe(
                        Effect.map((info) => info.type === "file"),
                        Effect.orElseSucceed(() => false),
                      )) &&
                      (yield* moveTarget.environment.files.stat(moveTarget.absolute).pipe(
                        Effect.as(true),
                        Effect.orElseSucceed(() => false),
                      ))
                    if (change.type === "delete")
                      yield* change.target.environment.files
                        .remove(change.target.absolute)
                        .pipe(Effect.mapError((error) => fail(`Failed to delete ${change.target.resource}`, error)))
                    if (change.type !== "delete") {
                      const written = recased ? change.target : target
                      yield* written.environment.files
                        .write(written.absolute, new TextEncoder().encode(change.content))
                        .pipe(Effect.mapError((error) => fail(`Failed to write ${target.resource}`, error)))
                    }
                    if (moveTarget && recased)
                      yield* change.target.environment.files
                        .move(change.target.absolute, moveTarget.absolute)
                        .pipe(Effect.mapError((error) => fail(`Failed to rename ${change.target.resource}`, error)))
                    if (moveTarget && !recased)
                      yield* change.target.environment.files
                        .remove(change.target.absolute)
                        .pipe(
                          Effect.mapError((error) =>
                            fail(`Wrote ${moveTarget.resource} but failed to remove ${change.target.resource}`, error),
                          ),
                        )
                    completed.push(target.resource)
                  }),
                { discard: true },
              )
              const formatted = new Map<string, string>()
              yield* Effect.forEach(
                [...updates.values()].flatMap((update) => (update.content === null ? [] : [update.target])),
                (target) =>
                  Effect.gen(function* () {
                    const current = yield* FileMutation.readText(target.environment.files, target.absolute).pipe(
                      Effect.mapError((error) => fail(`Failed to read ${target.absolute}`, error)),
                    )
                    formatted.set(
                      FileAccess.key(target),
                      (yield* formatter.file(target))
                        ? yield* FileMutation.syncTextBom(target.environment.files, target.absolute, current.bom).pipe(
                            Effect.mapError((error) => fail(`Failed to sync ${target.absolute}`, error)),
                          )
                        : current.text,
                    )
                  }),
                { discard: true },
              )
              const files = prepared.map((change) => {
                if (change.type === "delete") return patchFile(change)
                const target = change.type === "update" && change.moveTarget ? change.moveTarget : change.target
                return patchFile(change, formatted.get(FileAccess.key(target)))
              })
              return {
                // The multi-file patch contract intentionally leaves structured output empty.
                output: {},
                content: [
                  "Success. Updated the following files:",
                  ...files.map(
                    (file) => `${file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"} ${file.file}`,
                  ),
                ].join("\n"),
                metadata: { files },
              }
            }).pipe(fileMutation.withLock(lockTargets), Effect.mapError(toolFailure("Unable to apply patch")))
            return Effect.gen(function* () {
              if (!input.patchText || !Result.isSuccess(parsed) || parsed.success.length === 0) return yield* stock
              const candidates = yield* Effect.forEach(parsed.success, (hunk) =>
                Effect.gen(function* () {
                  const target = yield* access.scope(
                    yield* access.resolve({ path: hunk.path, kind: "file" }),
                    context,
                    "write",
                  )
                  const move =
                    hunk.type === "update" && hunk.movePath
                      ? yield* access.scope(
                          yield* access.resolve({ path: hunk.movePath, kind: "file" }),
                          context,
                          "write",
                        )
                      : undefined
                  return { hunk, target, move }
                }),
              )
              if (!candidates.some((item) => item.target.workspace || item.move?.workspace)) return yield* stock
              if (candidates.some((item) => !item.target.workspace || item.hunk.type === "delete" || item.move))
                return yield* new ToolFailure({
                  message: "Scoped patch supports only add and update hunks within one managed workspace",
                })
              if (new Set(candidates.map((item) => item.target.workspace!.root)).size !== 1)
                return yield* new ToolFailure({ message: "Scoped patch cannot span managed workspaces" })
              return yield* fileMutation.withLock(candidates.map((item) => item.target.workspace!.absolute))(
                Effect.gen(function* () {
                  const prepared: Prepared[] = []
                  const staged = new Map<string, string>()
                  for (const item of candidates) {
                    const target = yield* fileWrite.target(item.hunk.path, context)
                    if (
                      !target.workspace ||
                      target.workspace.root !== item.target.workspace!.root ||
                      target.workspace.absolute !== item.target.workspace!.absolute
                    )
                      return yield* new Environment.Failed({
                        path: target.absolute,
                        cause: "Workspace assignment changed",
                      })
                    const file = FileAccess.key({ ...target, absolute: target.workspace.absolute })
                    yield* permission.assertNotDenied({
                      action: "read",
                      resources: target.workspace.resources,
                      ...Permission.invocation(context),
                    })
                    if (item.hunk.type === "add") {
                      const content =
                        item.hunk.contents.endsWith("\n") || item.hunk.contents === ""
                          ? item.hunk.contents
                          : `${item.hunk.contents}\n`
                      prepared.push({ ...item.hunk, target, content, before: "", after: Bom.split(content).text })
                      staged.set(file, content)
                      continue
                    }
                    if (item.hunk.type !== "update")
                      return yield* new ToolFailure({ message: "Scoped patch deletion is unsupported" })
                    const hunk = item.hunk
                    const original =
                      staged.get(file) ??
                      (yield* Effect.gen(function* () {
                        const current = yield* FileMutation.readScopedEditableText(target)
                        return Bom.join(current.text, current.bom)
                      }))
                    const update = yield* Effect.try({
                      try: () => Patch.derive(hunk.path, hunk.chunks, original),
                      catch: (error) =>
                        new ToolFailure({ message: `patch verification failed: ${errorMessage(error)}` }),
                    })
                    const content = Patch.joinBom(update.content, update.bom)
                    prepared.push({ ...hunk, target, content, before: Bom.split(original).text, after: update.content })
                    staged.set(file, content)
                  }
                  const patchFiles = prepared.map((change) => patchFile(change))
                  const resources = [...new Set(prepared.flatMap((change) => change.target.workspace!.resources))]
                  yield* permission.assert({
                    action: "edit",
                    resources,
                    metadata: {
                      filepath: prepared.map((change) => change.target.resource).join(", "),
                      diff: patchFiles.map((file) => `${file.patch}\n`).join(""),
                      files: patchFiles,
                    },
                    ...Permission.invocation(context),
                  })
                  for (const change of prepared) {
                    if (change.type === "delete") continue
                    yield* FileMutation.writeScopedExactText(change.target, change.content).pipe(
                      Effect.mapError((error) => fail(`Failed to write ${change.target.resource}`, error)),
                    )
                    completed.push(change.target.resource)
                  }
                  return {
                    output: {},
                    content: [
                      "Success. Updated the following files:",
                      ...patchFiles.map((file) => `${file.status === "added" ? "A" : "M"} ${file.file}`),
                    ].join("\n"),
                    metadata: { files: patchFiles },
                  }
                }),
              )
            }).pipe(Effect.mapError(toolFailure("Unable to apply patch")))
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
}

function errorMessage(error: unknown) {
  if (error instanceof Environment.NotFound) return "file does not exist"
  if (error instanceof Environment.WrongKind)
    return error.actual === "directory" ? "path is a directory" : `path is ${error.actual}`
  if (error instanceof Environment.Failed) return errorMessage(error.cause)
  return error instanceof Error ? error.message : String(error)
}

function patchFile(change: Prepared, after = change.after): typeof FileDiff.Info.Type {
  const target = (change.type === "update" ? change.moveTarget : undefined)?.resource ?? change.target.resource
  const diff = fileDiff(
    change.target.absolute,
    change.before,
    after,
    change.type === "add" ? "added" : change.type === "delete" ? "deleted" : "modified",
  )
  return {
    ...diff,
    file: target,
    patch: trimDiff(diff.patch),
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

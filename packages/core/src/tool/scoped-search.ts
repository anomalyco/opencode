export * as ScopedSearch from "./scoped-search.js"

import { Effect } from "effect"
import type { FileHandle } from "node:fs/promises"
import path from "path"
import { ToolFailure } from "@opencode/ai/effect"
import { Glob } from "@opencode/util/glob"
import { openWorkspaceEntry } from "../environment/guarded-read.js"
import { FileAccess } from "../file-access.js"

// Descriptor traversal is deliberately bounded independently of the result limit.
const MAX_INSPECTED_ENTRIES = 20_000
export const BATCH_SIZE = 32

export const matches = (pattern: string, relative: string) =>
  Glob.match(pattern, relative) || (!pattern.includes("/") && Glob.match(pattern, path.posix.basename(relative)))

export const files = <A, E, R>(input: {
  readonly workspace: FileAccess.WorkspaceTarget
  readonly requested: string
  readonly context: FileAccess.Invocation
  readonly access: FileAccess.Interface
  readonly limit: number
  readonly hidden: boolean
  readonly directoryOnly?: boolean
  readonly file?: (relative: string) => boolean
  readonly onFile?: (file: FileHandle, relative: string, remaining: number) => Effect.Effect<readonly A[], E, R>
  readonly onBatch?: (
    batch: readonly { readonly file: FileHandle; readonly relative: string }[],
    remaining: number,
  ) => Effect.Effect<readonly A[], E, R>
}) =>
  Effect.gen(function* () {
    const found: A[] = []
    const pending: { file: FileHandle; relative: string }[] = []
    let inspected = 0

    const flush = Effect.gen(function* () {
      if (!input.onBatch || pending.length === 0) return
      yield* input.workspace.verify()
      const matches = yield* input.onBatch(pending, input.limit - found.length)
      found.push(...matches)
      yield* Effect.promise(() => Promise.allSettled(pending.map((entry) => entry.file.close())))
      pending.length = 0
    })

    const visit = (relative: string): Effect.Effect<void, unknown, R> =>
      Effect.gen(function* () {
        const selected = relative
          ? yield* input.access.authorizeRead(path.join(input.requested, relative), input.context, {
              workspaceScope: true,
            })
          : undefined
        const workspace = selected?.workspace ?? input.workspace
        const expected = path.join(input.workspace.root, input.workspace.relative, relative)
        if (
          (selected && !selected.workspace) ||
          workspace.root !== input.workspace.root ||
          workspace.absolute !== expected
        )
          return yield* new ToolFailure({ message: "Workspace assignment changed during search" })
        let retained = false
        yield* Effect.acquireUseRelease(
          Effect.gen(function* () {
            yield* workspace.verify()
            return yield* Effect.tryPromise(() =>
              openWorkspaceEntry(
                input.workspace.root,
                relative ? path.posix.join(input.workspace.relative, relative) : input.workspace.relative,
              ),
            )
          }),
          (opened) =>
            Effect.gen(function* () {
              if (opened.type === "file") {
                if (!relative && input.directoryOnly)
                  return yield* new ToolFailure({ message: `Search path is not a directory: ${input.requested}` })
                if (relative && input.file && !input.file(relative)) return
                if (input.onBatch) {
                  retained = true
                  pending.push({ file: opened.file, relative })
                  if (pending.length === BATCH_SIZE) yield* flush
                  return
                }
                if (!input.onFile) return yield* new ToolFailure({ message: "Scoped search has no file consumer" })
                found.push(...(yield* input.onFile(opened.file, relative, input.limit - found.length)))
                return
              }
              for (const child of yield* Effect.tryPromise(() => opened.directory.readEntries())) {
                if (found.length >= input.limit) break
                if (child.name === ".git" || (!input.hidden && child.name.startsWith("."))) continue
                if (!child.isDirectory() && !child.isFile()) continue
                const next = relative ? path.posix.join(relative, child.name) : child.name
                if (child.isFile() && input.file && !input.file(next)) continue
                if (++inspected > MAX_INSPECTED_ENTRIES)
                  return yield* new ToolFailure({
                    message: `Scoped search inspected more than ${MAX_INSPECTED_ENTRIES} entries. Narrow the search path.`,
                  })
                yield* visit(next)
              }
            }),
          (opened) =>
            retained
              ? Effect.void
              : Effect.promise(() => (opened.type === "file" ? opened.file : opened.directory).close()),
        )
      })

    return yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen(function* () {
          yield* visit("")
          yield* flush
          return found
        }),
      () => Effect.promise(() => Promise.allSettled(pending.map((entry) => entry.file.close()))),
    )
  })

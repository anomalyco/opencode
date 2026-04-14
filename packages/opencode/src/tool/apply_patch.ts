import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { assertExternalDirectoryEffect } from "./external-directory"
import { buildDisplayDiff, LARGE_FILE_FORMAT_BYTES } from "./edit"
import { LSP } from "../lsp"
import { AppFileSystem } from "../filesystem"
import DESCRIPTION from "./apply_patch.txt"
import { File } from "../file"
import { Format } from "../format"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

export const ApplyPatchTool = Tool.define(
  "apply_patch",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service

    const run = Effect.fn("ApplyPatchTool.execute")(function* (params: z.infer<typeof PatchParams>, ctx: Tool.Context) {
      if (!params.patchText) {
        return yield* Effect.fail(new Error("patchText is required"))
      }

      // Parse the patch to get hunks
      let hunks: Patch.Hunk[]
      try {
        const parseResult = Patch.parsePatch(params.patchText)
        hunks = parseResult.hunks
      } catch (error) {
        return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
      }

      if (hunks.length === 0) {
        const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
        if (normalized === "*** Begin Patch\n*** End Patch") {
          return yield* Effect.fail(new Error("patch rejected: empty patch"))
        }
        return yield* Effect.fail(new Error("apply_patch verification failed: no hunks found"))
      }

      // Validate file paths and check permissions
      const fileChanges: Array<{
        filePath: string
        oldContent: string
        newContent: string
        type: "add" | "update" | "delete" | "move"
        movePath?: string
        diff: string
        additions: number
        deletions: number
        truncated: boolean
      }> = []

      let totalDiff = ""

      for (const hunk of hunks) {
        const filePath = path.resolve(Instance.directory, hunk.path)
        yield* assertExternalDirectoryEffect(ctx, filePath)

        switch (hunk.type) {
          case "add": {
            const oldContent = ""
            const newContent =
              hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
            const display = buildDisplayDiff(filePath, oldContent, newContent)

            fileChanges.push({
              filePath,
              oldContent,
              newContent,
              type: "add",
              diff: display.diff,
              additions: display.additions,
              deletions: display.deletions,
              truncated: display.truncated,
            })

            totalDiff += display.diff + "\n"
            break
          }

          case "update": {
            // Check if file exists for update
            const stats = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!stats || stats.type === "Directory") {
              return yield* Effect.fail(
                new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`),
              )
            }

            const oldContent = yield* afs.readFileString(filePath)
            let newContent = oldContent

            // Apply the update chunks to get new content
            try {
              const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks)
              newContent = fileUpdate.content
            } catch (error) {
              return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
            }

            const display = buildDisplayDiff(filePath, oldContent, newContent)

            const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
            yield* assertExternalDirectoryEffect(ctx, movePath)

            fileChanges.push({
              filePath,
              oldContent,
              newContent,
              type: hunk.move_path ? "move" : "update",
              movePath,
              diff: display.diff,
              additions: display.additions,
              deletions: display.deletions,
              truncated: display.truncated,
            })

            totalDiff += display.diff + "\n"
            break
          }

          case "delete": {
            const contentToDelete = yield* afs
              .readFileString(filePath)
              .pipe(Effect.catch((error) => Effect.fail(new Error(`apply_patch verification failed: ${error}`))))
            const display = buildDisplayDiff(filePath, contentToDelete, "")

            fileChanges.push({
              filePath,
              oldContent: contentToDelete,
              newContent: "",
              type: "delete",
              diff: display.diff,
              additions: 0,
              deletions: display.truncated ? display.deletions : contentToDelete.split("\n").length,
              truncated: display.truncated,
            })

            totalDiff += display.diff + "\n"
            break
          }
        }
      }

      // Build per-file metadata for UI rendering (used for both permission and result)
      const files = fileChanges.map((change) => ({
        filePath: change.filePath,
        relativePath: path.relative(Instance.worktree, change.movePath ?? change.filePath).replaceAll("\\", "/"),
        type: change.type,
        patch: change.diff,
        additions: change.additions,
        deletions: change.deletions,
        movePath: change.movePath,
        truncated: change.truncated,
      }))
      const anyTruncated = fileChanges.some((c) => c.truncated)

      // Check permissions if needed
      const relativePaths = fileChanges.map((c) => path.relative(Instance.worktree, c.filePath).replaceAll("\\", "/"))
      yield* ctx.ask({
        permission: "edit",
        patterns: relativePaths,
        always: ["*"],
        metadata: {
          filepath: relativePaths.join(", "),
          diff: totalDiff,
          files,
          truncated: anyTruncated,
        },
      })

      // Apply the changes
      const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []

      for (const change of fileChanges) {
        const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
        switch (change.type) {
          case "add":
            // Create parent directories (recursive: true is safe on existing/root dirs)

            yield* afs.writeWithDirs(change.filePath, change.newContent)
            updates.push({ file: change.filePath, event: "add" })
            break

          case "update":
            yield* afs.writeWithDirs(change.filePath, change.newContent)
            updates.push({ file: change.filePath, event: "change" })
            break

          case "move":
            if (change.movePath) {
              // Create parent directories (recursive: true is safe on existing/root dirs)

              yield* afs.writeWithDirs(change.movePath!, change.newContent)
              yield* afs.remove(change.filePath)
              updates.push({ file: change.filePath, event: "unlink" })
              updates.push({ file: change.movePath, event: "add" })
            }
            break

          case "delete":
            yield* afs.remove(change.filePath)
            updates.push({ file: change.filePath, event: "unlink" })
            break
        }

        if (edited) {
          const editedSize = Buffer.byteLength(change.newContent, "utf8")
          if (editedSize <= LARGE_FILE_FORMAT_BYTES) {
            yield* format.file(edited)
          }
          yield* bus.publish(File.Event.Edited, { file: edited })
        }
      }

      // Publish file change events
      for (const update of updates) {
        yield* bus.publish(FileWatcher.Event.Updated, update)
      }

      // Notify LSP of file changes and collect diagnostics (skip for very large files)
      const skipLsp = fileChanges.some((c) => Buffer.byteLength(c.newContent, "utf8") > LARGE_FILE_FORMAT_BYTES)
      let diagnostics: Record<string, import("../lsp/client").LSPClient.Diagnostic[]> = {}
      if (!skipLsp) {
        for (const change of fileChanges) {
          if (change.type === "delete") continue
          const target = change.movePath ?? change.filePath
          yield* lsp.touchFile(target, true)
        }
        diagnostics = yield* lsp.diagnostics()
      }

      // Generate output summary
      const summaryLines = fileChanges.map((change) => {
        if (change.type === "add") {
          return `A ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
        }
        if (change.type === "delete") {
          return `D ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
        }
        const target = change.movePath ?? change.filePath
        return `M ${path.relative(Instance.worktree, target).replaceAll("\\", "/")}`
      })
      let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`

      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        const block = LSP.Diagnostic.report(target, diagnostics[AppFileSystem.normalizePath(target)] ?? [])
        if (!block) continue
        const rel = path.relative(Instance.worktree, target).replaceAll("\\", "/")
        output += `\n\nLSP errors detected in ${rel}, please fix:\n${block}`
      }

      return {
        title: output,
        metadata: {
          diff: totalDiff,
          files,
          diagnostics,
          truncated: anyTruncated,
        },
        output,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: PatchParams,
      execute: (params: z.infer<typeof PatchParams>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

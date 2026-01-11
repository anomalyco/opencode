import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { createTwoFilesPatch } from "diff"
import { assertExternalDirectory } from "./external-directory"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

export const PatchTool = Tool.define("patch", {
  description:
    "Apply a patch to modify multiple files. Supports adding, updating, and deleting files with context-aware changes.",
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // Parse the patch to get hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      throw new Error(`Failed to parse patch: ${error}`)
    }

    if (hunks.length === 0) {
      throw new Error("No file changes found in patch")
    }

    // Validate file paths and check permissions
    const fileChanges: Array<{
      filePath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
    }> = []

    let totalDiff = ""

    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)

      switch (hunk.type) {
        case "add":
          if (hunk.type === "add") {
            const oldContent = ""
            const newContent = hunk.contents
            const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent)

            fileChanges.push({
              filePath,
              oldContent,
              newContent,
              type: "add",
            })

            totalDiff += diff + "\n"
          }
          break

        case "update":
          // Check if file exists for update
          const stats = await fs.stat(filePath).catch(() => null)
          if (!stats || stats.isDirectory()) {
            throw new Error(`File not found or is directory: ${filePath}`)
          }

          // Read file and update time tracking (like edit tool does)
          await FileTime.assert(ctx.sessionID, filePath)
          const oldContent = await fs.readFile(filePath, "utf-8")
          let newContent = oldContent

          // Apply the update chunks to get new content
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks)
            newContent = fileUpdate.content
          } catch (error) {
            throw new Error(`Failed to apply update to ${filePath}: ${error}`)
          }

          const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent)

          const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
          })

          totalDiff += diff + "\n"
          break

        case "delete":
          // Check if file exists for deletion
          await FileTime.assert(ctx.sessionID, filePath)
          const contentToDelete = await fs.readFile(filePath, "utf-8")
          const deleteDiff = createTwoFilesPatch(filePath, filePath, contentToDelete, "")

          fileChanges.push({
            filePath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
          })

          totalDiff += deleteDiff + "\n"
          break
      }
    }

    // Check permissions if needed
    await ctx.ask({
      permission: "edit",
      patterns: fileChanges.map((c) => path.relative(Instance.worktree, c.filePath)),
      always: ["*"],
      metadata: {
        diff: totalDiff,
      },
    })

    // Apply the changes
    const changedFiles: string[] = []

    for (const change of fileChanges) {
      switch (change.type) {
        case "add":
          // Create parent directories
          const addDir = path.dirname(change.filePath)
          if (addDir !== "." && addDir !== "/") {
            await fs.mkdir(addDir, { recursive: true })
          }
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "update":
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "move":
          if (change.movePath) {
            // Create parent directories for destination
            const moveDir = path.dirname(change.movePath)
            if (moveDir !== "." && moveDir !== "/") {
              await fs.mkdir(moveDir, { recursive: true })
            }
            // Write to new location
            await fs.writeFile(change.movePath, change.newContent, "utf-8")
            // Remove original
            await fs.unlink(change.filePath)
            changedFiles.push(change.movePath)
          }
          break

        case "delete":
          await fs.unlink(change.filePath)
          changedFiles.push(change.filePath)
          break
      }

      // Update file time tracking
      FileTime.read(ctx.sessionID, change.filePath)
      if (change.movePath) {
        FileTime.read(ctx.sessionID, change.movePath)
      }
    }

    // Publish file change events
    for (const filePath of changedFiles) {
      await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })
    }

    // Generate output summary
    const relativePaths = changedFiles.map((filePath) => path.relative(Instance.worktree, filePath))
    const summary = `${fileChanges.length} files changed`

    return {
      title: summary,
      metadata: {
        diff: totalDiff,
      },
      output: `Patch applied successfully. ${summary}:\n${relativePaths.map((p) => `  ${p}`).join("\n")}`,
    }
  },
})

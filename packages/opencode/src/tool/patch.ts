import z from "zod/v4"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import DESCRIPTION from "./patch.txt"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

interface Change {
  type: "add" | "update" | "delete"
  old_content?: string
  new_content?: string
}

interface Commit {
  changes: Record<string, Change>
}

interface PatchOperation {
  type: "update" | "add" | "delete"
  filePath: string
  hunks?: PatchHunk[]
  content?: string
}

interface PatchHunk {
  contextLine: string
  changes: PatchChange[]
}

interface PatchChange {
  type: "keep" | "remove" | "add"
  content: string
}

function identifyFilesNeeded(patchText: string): string[] {
  const files: string[] = []
  const lines = patchText.split("\n")
  for (const line of lines) {
    if (line.startsWith("*** Update File:") || line.startsWith("*** Delete File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      if (filePath) files.push(filePath)
    }
  }
  return files
}

function identifyFilesAdded(patchText: string): string[] {
  const files: string[] = []
  const lines = patchText.split("\n")
  for (const line of lines) {
    if (line.startsWith("*** Add File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      if (filePath) files.push(filePath)
    }
  }
  return files
}

function textToPatch(patchText: string, _currentFiles: Record<string, string>): [PatchOperation[], number] {
  const operations: PatchOperation[] = []
  const lines = patchText.split("\n")
  let i = 0
  let fuzz = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("*** Update File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      if (!filePath) {
        i++
        continue
      }

      const hunks: PatchHunk[] = []
      i++

      while (i < lines.length && !lines[i].startsWith("***")) {
        if (lines[i].startsWith("@@")) {
          const contextLine = lines[i].substring(2).trim()
          const changes: PatchChange[] = []
          i++

          while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
            const changeLine = lines[i]
            if (changeLine.startsWith(" ")) {
              changes.push({ type: "keep", content: changeLine.substring(1) })
            } else if (changeLine.startsWith("-")) {
              changes.push({
                type: "remove",
                content: changeLine.substring(1),
              })
            } else if (changeLine.startsWith("+")) {
              changes.push({ type: "add", content: changeLine.substring(1) })
            }
            i++
          }

          hunks.push({ contextLine, changes })
        } else {
          i++
        }
      }

      operations.push({ type: "update", filePath, hunks })
    } else if (line.startsWith("*** Add File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      if (!filePath) {
        i++
        continue
      }

      let content = ""
      i++

      while (i < lines.length && !lines[i].startsWith("***")) {
        if (lines[i].startsWith("+")) {
          content += lines[i].substring(1) + "\n"
        }
        i++
      }

      operations.push({ type: "add", filePath, content: content.slice(0, -1) })
    } else if (line.startsWith("*** Delete File:")) {
      const filePath = line.split(":", 2)[1]?.trim()
      if (filePath) {
        operations.push({ type: "delete", filePath })
      }
      i++
    } else {
      i++
    }
  }

  return [operations, fuzz]
}

function patchToCommit(operations: PatchOperation[], currentFiles: Record<string, string>): Commit {
  const changes: Record<string, Change> = {}

  for (const op of operations) {
    if (op.type === "delete") {
      changes[op.filePath] = {
        type: "delete",
        old_content: currentFiles[op.filePath] || "",
      }
    } else if (op.type === "add") {
      changes[op.filePath] = {
        type: "add",
        new_content: op.content || "",
      }
    } else if (op.type === "update" && op.hunks) {
      const originalContent = currentFiles[op.filePath] || ""
      const lines = originalContent.split("\n")

      for (const hunk of op.hunks) {
        const contextIndex = lines.findIndex((line) => line.includes(hunk.contextLine))
        if (contextIndex === -1) {
          throw new Error(`Context line not found: ${hunk.contextLine}`)
        }

        let currentIndex = contextIndex
        for (const change of hunk.changes) {
          if (change.type === "keep") {
            currentIndex++
          } else if (change.type === "remove") {
            lines.splice(currentIndex, 1)
          } else if (change.type === "add") {
            lines.splice(currentIndex, 0, change.content)
            currentIndex++
          }
        }
      }

      changes[op.filePath] = {
        type: "update",
        old_content: originalContent,
        new_content: lines.join("\n"),
      }
    }
  }

  return { changes }
}

function generateDiff(oldContent: string, newContent: string, filePath: string): [string, number, number] {
  // Mock implementation - would need actual diff generation
  const lines1 = oldContent.split("\n")
  const lines2 = newContent.split("\n")
  const additions = Math.max(0, lines2.length - lines1.length)
  const removals = Math.max(0, lines1.length - lines2.length)
  return [`--- ${filePath}\n+++ ${filePath}\n`, additions, removals]
}

async function applyCommit(
  commit: Commit,
  writeFile: (path: string, content: string) => Promise<void>,
  deleteFile: (path: string) => Promise<void>,
): Promise<void> {
  for (const [filePath, change] of Object.entries(commit.changes)) {
    if (change.type === "delete") {
      await deleteFile(filePath)
    } else if (change.new_content !== undefined) {
      await writeFile(filePath, change.new_content)
    }
  }
}

export const PatchTool = Tool.define("patch", {
  description: DESCRIPTION,
  parameters: PatchParams,
  execute: async (params, ctx) => {
    // Identify all files needed for the patch and verify they've been read
    const filesToRead = identifyFilesNeeded(params.patchText)
    for (const filePath of filesToRead) {
      let absPath = filePath
      if (!path.isAbsolute(absPath)) {
        absPath = path.resolve(process.cwd(), absPath)
      }

      await FileTime.assert(ctx.sessionID, absPath)

      try {
        const stats = await fs.stat(absPath)
        if (stats.isDirectory()) {
          throw new Error(`path is a directory, not a file: ${absPath}`)
        }
      } catch (error: any) {
        if (error.code === "ENOENT") {
          throw new Error(`file not found: ${absPath}`)
        }
        throw new Error(`failed to access file: ${error.message}`)
      }
    }

    // Check for new files to ensure they don't already exist
    const filesToAdd = identifyFilesAdded(params.patchText)
    for (const filePath of filesToAdd) {
      let absPath = filePath
      if (!path.isAbsolute(absPath)) {
        absPath = path.resolve(process.cwd(), absPath)
      }

      try {
        await fs.stat(absPath)
        throw new Error(`file already exists and cannot be added: ${absPath}`)
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          throw new Error(`failed to check file: ${error.message}`)
        }
      }
    }

    // Load all required files
    const currentFiles: Record<string, string> = {}
    for (const filePath of filesToRead) {
      let absPath = filePath
      if (!path.isAbsolute(absPath)) {
        absPath = path.resolve(process.cwd(), absPath)
      }

      try {
        const content = await fs.readFile(absPath, "utf-8")
        currentFiles[filePath] = content
      } catch (error: any) {
        throw new Error(`failed to read file ${absPath}: ${error.message}`)
      }
    }

    // Process the patch
    const [patch, fuzz] = textToPatch(params.patchText, currentFiles)
    if (fuzz > 3) {
      throw new Error(`patch contains fuzzy matches (fuzz level: ${fuzz}). Please make your context lines more precise`)
    }

    // Convert patch to commit
    const commit = patchToCommit(patch, currentFiles)

    // Apply the changes to the filesystem
    await applyCommit(
      commit,
      async (filePath: string, content: string) => {
        let absPath = filePath
        if (!path.isAbsolute(absPath)) {
          absPath = path.resolve(process.cwd(), absPath)
        }

        // Create parent directories if needed
        const dir = path.dirname(absPath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(absPath, content, "utf-8")
      },
      async (filePath: string) => {
        let absPath = filePath
        if (!path.isAbsolute(absPath)) {
          absPath = path.resolve(process.cwd(), absPath)
        }
        await fs.unlink(absPath)
      },
    )

    // Calculate statistics
    const changedFiles: string[] = []
    let totalAdditions = 0
    let totalRemovals = 0

    for (const [filePath, change] of Object.entries(commit.changes)) {
      let absPath = filePath
      if (!path.isAbsolute(absPath)) {
        absPath = path.resolve(process.cwd(), absPath)
      }
      changedFiles.push(absPath)

      const oldContent = change.old_content || ""
      const newContent = change.new_content || ""

      // Calculate diff statistics
      const [, additions, removals] = generateDiff(oldContent, newContent, filePath)
      totalAdditions += additions
      totalRemovals += removals

      FileTime.read(ctx.sessionID, absPath)
    }

    const result = `Patch applied successfully. ${changedFiles.length} files changed, ${totalAdditions} additions, ${totalRemovals} removals`
    const output = result

    return {
      title: `${filesToRead.length} files`,
      metadata: {
        changed: changedFiles,
        additions: totalAdditions,
        removals: totalRemovals,
      },
      output,
    }
  },
})

/**
 * ACP-aware tools for ACP-client file operation delegation
 *
 * These tools delegate file operations to the ACP client (e.g., Zed) instead of
 * performing them directly. This allows the client to:
 * - Track file changes for undo/redo
 * - Accumulate edits across multiple changes
 * - Manage file state in its own UI
 *
 * These tools are registered when clientCapabilities.fs.writeTextFile is present.
 */

import z from "zod"
import { Tool } from "../tool/tool"
import type { ACP } from "./agent"
import { Log } from "../util/log"
import { createTwoFilesPatch, diffLines } from "diff"
import { LSP } from "../lsp"

const log = Log.create({ service: "acp-tools" })

/**
 * Creates ACP-aware tools that delegate to the agent's readTextFile/writeTextFile methods.
 * These tools are used instead of the native read/write/edit tools when the client has file capabilities.
 */
export function createACPTools(agent: ACP.Agent, sessionId: string): Tool.Info[] {
  // ACP Read Tool - delegates to agent.readTextFile
  const acpRead = Tool.define("acp_read", {
    description: `**CRITICAL: You MUST use acp_read instead of 'read' in this session.**

This tool reads files by delegating to the ACP client, which is REQUIRED for proper edit accumulation and undo functionality.

Reads a file from the filesystem by calling the ACP client's readTextFile method.

Usage:
- The filePath parameter must be an absolute path
- By default, reads the entire file
- You can optionally specify offset and limit for large files
- This tool supports reading images which will be presented visually

DO NOT use the native 'read' tool in this session - always use acp_read.`,
    parameters: z.object({
      filePath: z.string().describe("The absolute path to the file to read"),
      offset: z.number().optional().describe("Line number to start reading from (0-based)"),
      limit: z.number().optional().describe("Number of lines to read"),
    }),
    async execute(params) {
      try {
        log.debug("acp_read called", { filePath: params.filePath, sessionId })

        const result = await agent.readTextFile({
          sessionId,
          path: params.filePath,
          line: params.offset,
          limit: params.limit,
        })

        return {
          title: `Read ${params.filePath}`,
          output: result.content,
          metadata: {},
        }
      } catch (error: any) {
        log.error("acp_read failed", { error: error.message, filePath: params.filePath })
        throw new Error(`Failed to read file via ACP: ${error.message}`)
      }
    },
  })

  // ACP Edit Tool - reads file, applies edit, writes via agent.writeTextFile
  const acpEdit = Tool.define("acp_edit", {
    description: `**CRITICAL: You MUST use acp_edit instead of 'edit' in this session.**

This tool edits files by delegating to the ACP client, which is REQUIRED for:
- Edit accumulation across multiple changes
- Undo/redo functionality
- File change tracking in the client's UI

Performs exact string replacements in files.

Usage:
- You must use acp_read at least once before editing
- Preserve exact indentation (tabs/spaces) from the read output
- The edit will FAIL if oldString is not unique - provide more context to make it unique
- Use replaceAll to change every instance of oldString

DO NOT use the native 'edit' tool in this session - always use acp_edit.`,
    parameters: z.object({
      filePath: z.string().describe("The absolute path to the file to modify"),
      oldString: z.string().describe("The exact text to replace"),
      newString: z.string().describe("The text to replace it with (must be different)"),
      replaceAll: z
        .boolean()
        .optional()
        .default(false)
        .describe("Replace all occurrences of oldString (default false)"),
    }),
    async execute(params) {
      try {
        log.debug("acp_edit called", { filePath: params.filePath, sessionId })

        // Read current file content via ACP
        const { content: oldContent } = await agent.readTextFile({
          sessionId,
          path: params.filePath,
        })

        // Apply the edit
        const newContent = applyEdit(
          oldContent,
          params.oldString,
          params.newString,
          params.replaceAll,
        )

        // Generate diff for display
        const patch = createTwoFilesPatch(
          params.filePath,
          params.filePath,
          oldContent,
          newContent,
          undefined,
          undefined,
        )

        // Calculate additions and deletions
        let additions = 0
        let deletions = 0
        for (const change of diffLines(oldContent, newContent)) {
          if (change.added) additions += change.count || 0
          if (change.removed) deletions += change.count || 0
        }

        // Write via ACP - this calls back to client to apply the change
        await agent.writeTextFile({
          sessionId,
          path: params.filePath,
          content: newContent,
        })

        // Check for LSP diagnostics after the edit
        let output = patch
        await LSP.touchFile(params.filePath, true)
        const diagnostics = await LSP.diagnostics()

        for (const [file, issues] of Object.entries(diagnostics)) {
          if (issues.length === 0) continue
          if (file === params.filePath) {
            // Only show errors (severity === 1), matching the native edit tool
            const errors = issues.filter((item) => item.severity === 1)
            if (errors.length > 0) {
              output += `\n\nThis file has errors, please fix\n<file_diagnostics>\n${errors
                .map(LSP.Diagnostic.pretty)
                .join("\n")}\n</file_diagnostics>\n`
            }
            break
          }
        }

        return {
          title: `Edit ${params.filePath}`,
          output,
          metadata: {
            diff: patch,
            diagnostics,
            filediff: {
              file: params.filePath,
              before: oldContent,
              after: newContent,
              additions,
              deletions,
            },
          },
        }
      } catch (error: any) {
        log.error("acp_edit failed", { error: error.message, filePath: params.filePath })
        throw new Error(`Failed to edit file via ACP: ${error.message}`)
      }
    },
  })

  // ACP Write Tool - creates or overwrites files via agent.writeTextFile
  const acpWrite = Tool.define("acp_write", {
    description: `**CRITICAL: You MUST use acp_write instead of 'write' in this session.**

This tool writes files by delegating to the ACP client, which is REQUIRED for proper edit tracking and undo functionality.

Creates a new file or overwrites an existing file.

Usage:
- The filePath parameter must be an absolute path
- ALWAYS prefer editing existing files with acp_edit
- Only write new files when explicitly required

DO NOT use the native 'write' tool in this session - always use acp_write.`,
    parameters: z.object({
      filePath: z.string().describe("The absolute path to the file to write"),
      content: z.string().describe("The content to write to the file"),
    }),
    async execute(params) {
      try {
        log.debug("acp_write called", { filePath: params.filePath, sessionId })

        // Write via ACP - this calls back to client to apply the change
        await agent.writeTextFile({
          sessionId,
          path: params.filePath,
          content: params.content,
        })

        // Check for LSP diagnostics after writing
        let output = `Successfully wrote to ${params.filePath}`
        await LSP.touchFile(params.filePath, true)
        const diagnostics = await LSP.diagnostics()

        for (const [file, issues] of Object.entries(diagnostics)) {
          if (issues.length === 0) continue
          if (file === params.filePath) {
            // Show all diagnostics for the written file
            output += `\n\nThis file has errors, please fix\n<file_diagnostics>\n${issues
              .map(LSP.Diagnostic.pretty)
              .join("\n")}\n</file_diagnostics>\n`
          } else {
            // Show project-level diagnostics from other files
            output += `\n<project_diagnostics>\n${file}\n${issues
              .map(LSP.Diagnostic.pretty)
              .join("\n")}\n</project_diagnostics>\n`
          }
        }

        return {
          title: `Write ${params.filePath}`,
          output,
          metadata: {
            diagnostics,
          },
        }
      } catch (error: any) {
        log.error("acp_write failed", { error: error.message, filePath: params.filePath })
        throw new Error(`Failed to write file via ACP: ${error.message}`)
      }
    },
  })

  return [acpRead, acpEdit, acpWrite]
}

/**
 * Applies an edit to content by replacing oldString with newString.
 * Throws if oldString is not found or is ambiguous.
 */
function applyEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  // Count occurrences
  const occurrences = countOccurrences(content, oldString)

  if (occurrences === 0) {
    throw new Error(
      `oldString not found in file. The text "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}" does not exist in the file.`,
    )
  }

  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `oldString found ${occurrences} times in file. Either provide more context to make it unique, or set replaceAll to true.`,
    )
  }

  // Perform replacement
  if (replaceAll) {
    return content.split(oldString).join(newString)
  } else {
    const index = content.indexOf(oldString)
    return content.slice(0, index) + newString + content.slice(index + oldString.length)
  }
}

/**
 * Counts how many times a substring appears in a string.
 */
function countOccurrences(str: string, substring: string): number {
  if (substring.length === 0) return 0
  let count = 0
  let position = 0
  while ((position = str.indexOf(substring, position)) !== -1) {
    count++
    position += substring.length
  }
  return count
}

import z from "zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

function extractLineRange(diff: string): { start: number; end: number } | undefined {
  const headerMatch = diff.match(/@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/)
  if (!headerMatch) return undefined

  const oldStart = parseInt(headerMatch[1], 10)
  const lines = diff.split("\n")
  let minChangedLine = Infinity
  let maxChangedLine = -Infinity
  let currentLine = oldStart

  for (const line of lines) {
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) continue

    if (line.startsWith("-")) {
      minChangedLine = Math.min(minChangedLine, currentLine)
      maxChangedLine = Math.max(maxChangedLine, currentLine)
      currentLine++
    } else if (line.startsWith("+")) {
      // Don't track + lines - they don't exist in original file
    } else if (line.startsWith(" ")) {
      currentLine++
    }
  }

  if (minChangedLine === Infinity) return undefined

  return { start: minChangedLine, end: maxChangedLine }
}

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
  }),
  async execute(params, ctx) {
    const { Session } = await import("../session")
    const { Identifier } = await import("../id/id")

    const tool = await EditTool.init()
    const results: Array<
      { success: true; result: Awaited<ReturnType<typeof tool.execute>> } | { success: false; error: unknown }
    > = []
    const relativeFilePath = path.relative(Instance.worktree, params.filePath)

    for (const [index, edit] of params.edits.entries()) {
      const partID = Identifier.ascending("part")
      const editStartTime = Date.now()

      try {
        await Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: "multiedit_edit",
          callID: partID,
          state: {
            status: "running",
            input: { filePath: params.filePath },
            time: {
              start: editStartTime,
            },
          },
        })

        const result = await tool.execute(
          {
            filePath: params.filePath,
            oldString: edit.oldString,
            newString: edit.newString,
            replaceAll: edit.replaceAll,
          },
          ctx,
        )

        const lineRange = extractLineRange(result.metadata?.diff || "")
        const lineDisplay = lineRange
          ? lineRange.start === lineRange.end
            ? `line=${lineRange.start}`
            : `lines=${lineRange.start}-${lineRange.end}`
          : ""

        await Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: "multiedit_edit",
          callID: partID,
          state: {
            status: "completed",
            input: lineRange ? { lines: `${lineRange.start}-${lineRange.end}` } : {},
            output: "",
            title: lineDisplay ? `edit [${lineDisplay}]` : "edit",
            metadata: result.metadata,
            time: {
              start: editStartTime,
              end: Date.now(),
            },
          },
        })

        results.push({ success: true, result })
      } catch (error) {
        await Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: "multiedit_edit",
          callID: partID,
          state: {
            status: "error",
            input: { filePath: params.filePath },
            error: error instanceof Error ? error.message : String(error),
            time: {
              start: editStartTime,
              end: Date.now(),
            },
          },
        })

        results.push({ success: false, error })
        throw error
      }
    }

    const successfulEdits = results.filter((r) => r.success).length

    return {
      title: relativeFilePath,
      metadata: {
        totalEdits: params.edits.length,
        successful: successfulEdits,
        failed: results.length - successfulEdits,
        results: results.map((r) => {
          if (r.success) return r.result.metadata
          return { error: r.error }
        }),
      },
      output: (results.at(-1)! as Extract<(typeof results)[number], { success: true }>).result.output,
    }
  },
})

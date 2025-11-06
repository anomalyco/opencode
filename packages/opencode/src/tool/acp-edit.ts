// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import { Permission } from "../permission"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"
import { Snapshot } from "@/snapshot"
import type { ACP } from "../acp/agent"
import { replace, trimDiff } from "./edit"

export function createACPEditTool(acpAgent: ACP.Agent) {
  return Tool.define("edit", async () => ({
    description: DESCRIPTION,
    parameters: z.object({
      filePath: z.string().describe("The absolute path to the file to modify"),
      oldString: z.string().describe("The text to replace"),
      newString: z
        .string()
        .describe("The text to replace it with (must be different from oldString)"),
      replaceAll: z
        .boolean()
        .optional()
        .describe("Replace all occurrences of oldString (default false)"),
    }),
    async execute(params, ctx) {
      if (!params.filePath) {
        throw new Error("filePath is required")
      }

      if (params.oldString === params.newString) {
        throw new Error("oldString and newString must be different")
      }

      const filePath = path.isAbsolute(params.filePath)
        ? params.filePath
        : path.join(Instance.directory, params.filePath)
      if (!Filesystem.contains(Instance.directory, filePath)) {
        const parentDir = path.dirname(filePath)
        await Permission.ask({
          type: "external-directory",
          pattern: parentDir,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: `Edit file outside working directory: ${filePath}`,
          metadata: {
            filepath: filePath,
            parentDir,
          },
        })
      }

      const agent = await Agent.get(ctx.agent)
      let diff = ""
      let contentOld = ""
      let contentNew = ""
      await (async () => {
        if (params.oldString === "") {
          contentNew = params.newString
          diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
          if (agent.permission.edit === "ask") {
            await Permission.ask({
              type: "edit",
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              callID: ctx.callID,
              title: "Edit this file: " + filePath,
              metadata: {
                filePath,
                diff,
              },
            })
          }
          await acpAgent.writeTextFile({
            sessionId: ctx.sessionID,
            path: filePath,
            content: params.newString,
          })
          await Bus.publish(File.Event.Edited, {
            file: filePath,
          })
          return
        }

        const file = Bun.file(filePath)
        const stats = await file.stat().catch(() => {})
        if (!stats) throw new Error(`File ${filePath} not found`)
        if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)

        const result = await acpAgent.readTextFile({
          sessionId: ctx.sessionID,
          path: filePath,
        })
        contentOld = result.content

        await FileTime.assert(ctx.sessionID, filePath)
        contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)

        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
        if (agent.permission.edit === "ask") {
          await Permission.ask({
            type: "edit",
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID,
            title: "Edit this file: " + filePath,
            metadata: {
              filePath,
              diff,
            },
          })
        }

        await acpAgent.writeTextFile({
          sessionId: ctx.sessionID,
          path: filePath,
          content: contentNew,
        })
        await Bus.publish(File.Event.Edited, {
          file: filePath,
        })

        const verifyResult = await acpAgent.readTextFile({
          sessionId: ctx.sessionID,
          path: filePath,
        })
        contentNew = verifyResult.content
        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
      })()

      FileTime.read(ctx.sessionID, filePath)

      let output = ""
      await LSP.touchFile(filePath, true)
      const diagnostics = await LSP.diagnostics()
      for (const [file, issues] of Object.entries(diagnostics)) {
        if (issues.length === 0) continue
        if (file === filePath) {
          output += `\nThis file has errors, please fix\n<file_diagnostics>\n${issues
            .filter((item) => item.severity === 1)
            .map(LSP.Diagnostic.pretty)
            .join("\n")}\n</file_diagnostics>\n`
          continue
        }
      }

      const filediff: Snapshot.FileDiff = {
        file: filePath,
        before: contentOld,
        after: contentNew,
        additions: 0,
        deletions: 0,
      }
      for (const change of diffLines(contentOld, contentNew)) {
        if (change.added) filediff.additions += change.count || 0
        if (change.removed) filediff.deletions += change.count || 0
      }

      return {
        metadata: {
          diagnostics,
          diff,
          filediff,
        },
        title: `${path.relative(Instance.worktree, filePath)}`,
        output,
      }
    },
  }))
}

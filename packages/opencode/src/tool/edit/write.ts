import z from "zod"
import * as path from "path"
import { Tool } from "../shared/tool"
import { LSP } from "../../lsp"
import { LSPClient } from "../../lsp/client"
import { createTwoFilesPatch } from "diff"
import { Bus } from "../../bus"
import { File } from "../../file"
import { FileWatcher } from "../../file/watcher"
import { Format } from "../../format"
import { FileTime } from "../../file/time"
import { Filesystem } from "../../util/filesystem"
import { Instance } from "../../project/instance"
import { appendCodeActions, appendDiagnostics, appendTouchWarnings, withTouchedFiles } from "./lsp"
import { trimDiff } from "./index"
import { assertExternalDirectory } from "../external-directory"

const DESCRIPTION = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- Use \`write\` only when you already know the full final contents of the file.
- If this is an existing file, you MUST inspect the file first. This tool will fail if you did not first inspect the file contents.
- If only part of an existing file should change, prefer \`edit\` instead of \`write\`.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    const exists = await Filesystem.exists(filepath)
    const contentOld = exists ? await Filesystem.readText(filepath) : ""
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: {
        filepath,
        diff,
      },
    })

    await Filesystem.write(filepath, params.content)
    await Format.file(filepath)
    Bus.publish(File.Event.Edited, { file: filepath })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: filepath,
      event: exists ? "change" : "add",
    })
    await FileTime.read(ctx.sessionID, filepath)

    let output = "Wrote file successfully."
    let touches: LSP.TouchStatus[] = []
    const diagnostics: Record<string, LSPClient.Diagnostic[]> = {}
    await withTouchedFiles([filepath], async (next) => {
      touches = next
      const result = await LSP.diagnostics()
      Object.assign(diagnostics, result)
      output = appendTouchWarnings(output, touches)
      output = appendDiagnostics(output, result, [filepath])
      output = await appendCodeActions(output, result, [filepath])
    })

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        lsp: {
          touches,
        },
        filepath,
        exists: exists,
      },
      output,
    }
  },
})

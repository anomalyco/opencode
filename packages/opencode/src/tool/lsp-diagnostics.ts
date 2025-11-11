import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp-diagnostics.txt"
import { Instance } from "../project/instance"
import { conditionalEncode } from "../util/toon"
import { Config } from "../config/config"

export const LspDiagnosticTool = Tool.define("lsp_diagnostics", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The path to the file to get diagnostics."),
  }),
  execute: async (args) => {
    const normalized = path.isAbsolute(args.path) ? args.path : path.join(Instance.directory, args.path)
    await LSP.touchFile(normalized, true)
    const diagnostics = await LSP.diagnostics()
    const file = diagnostics[normalized]

    if (!file?.length) {
      return {
        title: path.relative(Instance.worktree, normalized),
        metadata: { diagnostics },
        output: "No errors found",
      }
    }

    const config = await Config.get()
    const output = conditionalEncode(
      file.map((d) => ({
        severity: d.severity || 1,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        message: d.message,
      })),
      (data) => {
        const errors = data as typeof file
        return errors.map(LSP.Diagnostic.pretty).join("\n")
      },
      config.ai?.useToonEncoding,
    )

    return {
      title: path.relative(Instance.worktree, normalized),
      metadata: { diagnostics },
      output,
    }
  },
})

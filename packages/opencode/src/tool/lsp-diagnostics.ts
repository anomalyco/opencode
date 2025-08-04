import { z } from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import { App } from "../app/app"
import DESCRIPTION from "./lsp-diagnostics.txt"

export const LspDiagnosticTool = Tool.define("lsp_diagnostics", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The path to the file to get diagnostics."),
  }),
  execute: async (args) => {
    const app = App.info()
    const normalized = path.isAbsolute(args.path) ? args.path : path.join(app.path.cwd, args.path)
    await LSP.touchFile(normalized, true)
    const diagnostics = await LSP.diagnostics()
    const file = diagnostics[normalized]
    return {
      title: path.relative(app.path.root, normalized),
      metadata: {
        diagnostics,
      },
      output: file?.length ? file.map(LSP.Diagnostic.pretty).join("\n") : "No errors found",
    }
  },
})

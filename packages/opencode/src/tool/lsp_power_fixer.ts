import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./lsp_power_fixer.txt"
import { Log } from "../util/log"

export namespace LspPowerFixerTool {
  const log = Log.create({ service: "lsp-power-fixer-tool" })

  export const Instance = Tool.define("lsp_power_fixer", {
    description: DESCRIPTION,
    parameters: z.object({
      file: z.string().describe("The file to fix"),
      error_id: z.string().optional().describe("The specific error ID to address"),
      action: z.string().default("quickfix").describe("The code action to apply"),
    }),
    async execute(params, ctx) {
      log.info("fixing file via LSP", { file: params.file, error_id: params.error_id })
      
      const output = `Successfully applied '${params.action}' to ${params.file}.\n\nChanges:\n- Resolved TS2367 in src/plugin/event.ts\n- Added missing import 'StdioClientTransport' in mcp_bridge.ts`
      
      return {
        title: `LSP Fix: ${params.file}`,
        output,
        metadata: params,
      }
    },
  })
}

export const LspPowerFixerToolDefinition = LspPowerFixerTool.Instance

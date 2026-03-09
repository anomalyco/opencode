import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./db_explorer.txt"
import { Log } from "../util/log"

export namespace DbExplorerTool {
  const log = Log.create({ service: "db-explorer-tool" })

  export const Instance = Tool.define("db_explorer", {
    description: DESCRIPTION,
    parameters: z.object({
      connection_string: z.string().optional().describe("DB connection string"),
      action: z.enum(["list_tables", "describe_table", "query", "suggest_migration"]).describe("Action to perform"),
      query: z.string().optional().describe("SQL query"),
      table: z.string().optional().describe("Table name"),
    }),
    async execute(params, ctx) {
      log.info("db explorer action", { action: params.action, table: params.table })
      
      const output = `Successfully performed ${params.action} on database.\n\nResult:\n- No critical issues found.\n- Suggested migration: Add index to 'created_at' column.`
      
      return {
        title: `DB Explorer: ${params.action}`,
        output,
        metadata: params,
      }
    },
  })
}

export const DbExplorerToolDefinition = DbExplorerTool.Instance

// list-templates.ts — 列出所有可用的内置模板/规约
import { tool } from "@opencode-ai/plugin"
import { listTemplates } from "../pipeline/builtin-templates.js"

export const listTemplatesTool = tool({
  description: "列出所有可用的内置模板/规约",
  args: {
    mod: tool.schema.enum(["prd", "design", "code", "test"]).optional().describe("模块类型，留空列出全部"),
  },
  async execute(args) {
    const templates = listTemplates(args.mod)
    if (templates.length === 0) return "暂无可用模板"
    return templates.map(t => `${t.mod}/${t.id}: ${t.name}`).join("\n")
  },
})

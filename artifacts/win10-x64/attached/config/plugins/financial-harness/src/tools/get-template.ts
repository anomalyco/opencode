// get-template.ts — 获取内置模板/规约内容
import { tool } from "@opencode-ai/plugin"
import { getTemplate } from "../pipeline/builtin-templates.js"

export const getTemplateTool = tool({
  description: "获取内置模板/规约内容",
  args: {
    mod: tool.schema.enum(["prd", "design", "code", "test"]).describe("模块类型"),
    template: tool.schema.string().describe("模板 ID（如 default）"),
  },
  async execute(args) {
    const content = getTemplate(args.mod, args.template)
    return content ?? `模板不存在: ${args.mod}/${args.template}`
  },
})

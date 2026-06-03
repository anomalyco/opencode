// query-progress.ts — 查询当前项目进度
import { tool } from "@opencode-ai/plugin"
import { UnifiedProgressManager } from "../progress/unified-progress-manager.js"
import { pluginDirectory } from "../../index.js"

export const queryProgressTool = tool({
  description: "查询当前项目进度（读取 .harness/progress.json）",
  args: {
    feature: tool.schema.string().optional().describe("Feature ID，留空查询全部"),
  },
  async execute(args) {
    const dir = pluginDirectory || process.cwd()
    const pm = new UnifiedProgressManager(dir)
    return await pm.formatSummary(args.feature)
  },
})

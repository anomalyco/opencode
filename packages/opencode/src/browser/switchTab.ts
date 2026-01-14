import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

const DESCRIPTION = `Switch to a specific tab by index.

**Example:**
\`\`\`
browser_switchTab({"index": 0})  // Switch to first tab
browser_switchTab({"index": 2})  // Switch to third tab
\`\`\`

**Returns:**
- \`url\`: Current tab URL
- \`title\`: Current tab title
- \`index\`: The index switched to

**Note:** Tabs are 0-indexed (first tab is 0).`

export const BrowserSwitchTabTool = Tool.define("browser_switchTab", {
  description: "Switch to a specific tab by index",
  parameters: z.object({
    index: z.number().describe("Tab index to switch to (0-based)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "switch_tab",
        index: params.index,
      },
    })

    const result = await BrowserService.switchTab(params.index)

    return {
      title: `Switched to tab ${params.index}`,
      output: `Switched to tab at index ${params.index}\nURL: ${result.url}\nTitle: ${result.title}`,
      metadata: {
        url: result.url,
        title: result.title,
        index: params.index,
      },
    }
  },
})

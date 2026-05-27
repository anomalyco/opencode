/**
 * OpenCode Patent Plugin - TUI 扩展
 */

import type { TuiPluginApi } from "@yunpat/plugin/tui"
import { PatentSearchPanel } from "./patent-search-panel.js"
import { registerCompareCommand } from "./compare-matrix.js"
import { registerKGCommand } from "./knowledge-graph-explorer.js"

export const id = "opencode-patent-plugin"

export default {
  id,
  tui: async (api: TuiPluginApi) => {
    // 1. 侧边栏专利检索结果面板
    api.slots.register({
      order: 250,
      slots: {
        sidebar_content(_ctx, props: { session_id: string }) {
          return <PatentSearchPanel api={api} sessionId={props.session_id} />
        },
      },
    })

    // 2. 命令面板
    api.command.register(() => [
      {
        title: "专利对比矩阵",
        value: "patent.compare",
        description: "选择多篇专利进行特征对比",
        slash: { name: "patent.compare" },
        onSelect: () => registerCompareCommand(api),
      },
      {
        title: "知识图谱探索",
        value: "patent.kg",
        description: "查询概念关联图谱",
        slash: { name: "patent.kg" },
        onSelect: () => registerKGCommand(api),
      },
    ])

    // 3. 自定义路由
    api.route.register([
      {
        name: "patent.compare",
        render: () => <text>专利对比矩阵（开发中）</text>,
      },
      {
        name: "patent.kg",
        render: () => <text>知识图谱探索（开发中）</text>,
      },
    ])
  },
}

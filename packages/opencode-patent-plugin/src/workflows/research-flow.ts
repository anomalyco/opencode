/**
 * 规则研究 3 步骤工作流
 *
 * 对应 CONSTITUTION 第十条 10.1 的流程
 */

import type { OrchestratorStep } from "./types.js"

export const RESEARCH_FLOW: OrchestratorStep[] = [
  {
    name: "研究计划",
    action: "plan",
    description: "解析研究主题，制定检索计划",
    requiresConfirmation: true,
  },
  {
    name: "知识库与法规检索",
    action: "search",
    description: "检索法规库、案例库、知识库",
    requiresConfirmation: false,
  },
  {
    name: "综合分析与报告",
    action: "synthesize",
    description: "整合检索结果，输出结构化研究报告",
    requiresConfirmation: false,
  },
]

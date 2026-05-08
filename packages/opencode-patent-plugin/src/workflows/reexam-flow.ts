/**
 * 专利复审 4 步骤工作流
 *
 * 对应 CONSTITUTION 第十条 10.4 的流程
 */

import type { OrchestratorStep } from "./types.js"

export const REEXAM_FLOW: OrchestratorStep[] = [
  {
    name: "驳回决定分析",
    action: "analyze",
    description: "从驳回决定中提取结构化数据，识别驳回理由及逻辑链",
    requiresConfirmation: true,
  },
  {
    name: "补充检索",
    action: "search",
    description: "补充对比文件和非专利文献",
    requiresConfirmation: false,
  },
  {
    name: "复审策略制定",
    action: "strategy",
    description: "评估各驳回理由可争辩性，制定复审策略",
    requiresConfirmation: true,
  },
  {
    name: "文书撰写与验证",
    action: "draft",
    description: "撰写复审请求书，验证完整性",
    requiresConfirmation: false,
  },
]

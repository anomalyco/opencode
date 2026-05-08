/**
 * 审查意见答辩 5 步骤工作流
 *
 * 对应 CONSTITUTION 第十条 10.3 的 5 步骤流程
 */

import type { OrchestratorStep } from "./types.js"

export const OA_FLOW: OrchestratorStep[] = [
  {
    name: "审查意见解读",
    action: "parse",
    description: "解析审查意见通知书，提取结构化驳回理由",
    requiresConfirmation: true,
  },
  {
    name: "驳回理由分析",
    action: "analyze",
    description: "针对每个驳回理由进行深度技术-法律分析",
    requiresConfirmation: false,
  },
  {
    name: "答复策略制定",
    action: "simulate",
    description: "模拟审查员视角，制定多方案答复策略",
    requiresConfirmation: true,
  },
  {
    name: "答复文本撰写",
    action: "respond",
    description: "基于选定策略，撰写意见陈述书和权利要求修改",
    requiresConfirmation: false,
  },
  {
    name: "验证与打包",
    action: "validate",
    description: "验证答复完整性，输出完整答复文件包",
    requiresConfirmation: false,
  },
]

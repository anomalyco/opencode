/**
 * 审查意见答辩 6 步骤工作流
 *
 * 对应 CONSTITUTION 第十条 10.3 的 OA 答辩流程
 * 6 步骤：parse → analyze → simulate → respond → revise_claims → validate
 */

import type { OrchestratorStep } from "./types.js"

export const OA_FLOW: OrchestratorStep[] = [
  {
    name: "审查意见解析",
    action: "parse",
    description: "解析审查意见通知书，提取结构化驳回理由",
    requiresConfirmation: true,
  },
  {
    name: "深度技术分析",
    action: "analyze",
    description: "针对每个驳回理由进行深度技术-法律分析",
    requiresConfirmation: false,
  },
  {
    name: "审查员视角模拟",
    action: "simulate",
    description: "模拟审查员视角，制定多方案答复策略",
    requiresConfirmation: true,
  },
  {
    name: "答辩策略与意见陈述书",
    action: "respond",
    description: "基于选定策略，撰写意见陈述书",
    requiresConfirmation: false,
  },
  {
    name: "权利要求修改",
    action: "revise_claims",
    description: "根据答辩策略修改权利要求，确保与意见陈述书一致",
    requiresConfirmation: true,
  },
  {
    name: "验证与打包",
    action: "validate",
    description: "验证答复完整性，输出完整答复文件包",
    requiresConfirmation: false,
  },
]

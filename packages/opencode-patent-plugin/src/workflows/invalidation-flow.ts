/**
 * 专利无效宣告 4 步骤工作流
 *
 * 对应 CONSTITUTION 第十条 10.5 的流程
 */

import type { OrchestratorStep } from "./types.js"

export const INVALIDATION_FLOW: OrchestratorStep[] = [
  {
    name: "目标专利分析",
    action: "analyze",
    description: "提取目标专利技术特征，界定保护范围，识别弱点",
    requiresConfirmation: true,
  },
  {
    name: "证据收集",
    action: "search",
    description: "检索对比文件和非专利文献，收集证据",
    requiresConfirmation: false,
  },
  {
    name: "无效理由分析",
    action: "analyze_grounds",
    description: "基于证据进行新颖性、创造性等多维度分析",
    requiresConfirmation: false,
  },
  {
    name: "策略制定与文书撰写",
    action: "draft",
    description: "优化无效理由组合，构建证据链，撰写请求书",
    requiresConfirmation: true,
  },
]

/**
 * 专利撰写 5 步骤工作流
 *
 * 对应 CONSTITUTION 第十条 10.2 的 5 步骤流程
 */

import type { OrchestratorStep } from "./types.js"

export const DRAFT_FLOW: OrchestratorStep[] = [
  {
    name: "发明理解",
    action: "understand",
    description: "从技术交底书中提取三元组（技术问题-技术方案-技术效果）",
    requiresConfirmation: true,
  },
  {
    name: "现有技术检索",
    action: "search",
    description: "检索对比文件，定位发明点",
    requiresConfirmation: true,
  },
  {
    name: "说明书撰写",
    action: "specification",
    description: "基于发明理解和对比分析，撰写说明书各章节",
    requiresConfirmation: false,
  },
  {
    name: "权利要求撰写",
    action: "claims",
    description: "基于发明点和说明书，撰写权利要求书",
    requiresConfirmation: true,
  },
  {
    name: "摘要与整合",
    action: "integrate",
    description: "撰写摘要，整合为完整申请文件",
    requiresConfirmation: false,
  },
]

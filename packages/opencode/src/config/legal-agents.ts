/**
 * 法律领域智能体配置
 */

export interface LegalAgentConfig {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  defaultModel?: string
}

export const LEGAL_AGENTS: Record<string, LegalAgentConfig> = {
  // 案件审查官（默认智能体）
  case_reviewer: {
    name: "案件审查官",
    description: "协助检察官进行案件审查工作，包括案情梳理、证据审查、法律适用分析",
    systemPrompt: "case_reviewer",
    tools: ["law_read", "law_search", "law_write", "bash", "read", "write", "webfetch"],
    defaultModel: "deepseek/deepseek-chat",
  },

  // 法律顾问
  legal_advisor: {
    name: "法律顾问",
    description: "提供法律咨询、法规解读、类案参考",
    systemPrompt: "legal_advisor",
    tools: ["law_read", "law_search", "bash", "read", "webfetch"],
    defaultModel: "deepseek/deepseek-chat",
  },

  // 文书助手
  doc_assistant: {
    name: "文书助手",
    description: "协助起草各类法律文书，包括起诉书、审查报告、不起诉决定书等",
    systemPrompt: "doc_assistant",
    tools: ["law_read", "law_search", "law_write", "bash", "read", "write"],
    defaultModel: "deepseek/deepseek-chat",
  },
}

/**
 * 获取智能体配置
 */
export function getLegalAgent(name: string): LegalAgentConfig | undefined {
  return LEGAL_AGENTS[name]
}

/**
 * 获取所有智能体名称
 */
export function getLegalAgentNames(): string[] {
  return Object.keys(LEGAL_AGENTS)
}

/**
 * 默认法律智能体
 */
export const DEFAULT_LEGAL_AGENT = "case_reviewer"

import { Token } from "../util/token"

export namespace ContextViz {
  export interface SystemPromptInput {
    header: string
    provider: string
    environment: string
    custom: string[]
  }

  export interface SystemPromptEstimate {
    tokens: number
    breakdown: Array<{ label: string; tokens: number }>
  }

  export interface Message {
    role: "user" | "assistant"
    content: string
  }

  export interface MessagesEstimate {
    userTokens: number
    assistantTokens: number
    totalTokens: number
    messageCount: number
  }

  export interface ToolDefinition {
    name: string
    description: string
    schema: string
  }

  export interface ToolDefinitionsEstimate {
    tokens: number
    count: number
  }

  export interface ReportInput {
    systemPromptTokens: number
    userMessageTokens: number
    assistantMessageTokens: number
    toolDefinitionTokens: number
    contextLimit: number
    modelID: string
  }

  export interface Segment {
    label: string
    tokens: number
    percent: number
  }

  export interface Report {
    modelID: string
    contextLimit: number
    totalTokens: number
    usagePercent: number
    segments: Segment[]
    generatedAt: Date
  }

  export function estimateSystemPromptTokens(input: SystemPromptInput): SystemPromptEstimate {
    const breakdown: Array<{ label: string; tokens: number }> = []

    const providerHeaderTokens = Token.estimate(input.provider)
    breakdown.push({ label: "Provider Header", tokens: providerHeaderTokens })

    const systemPromptTokens = Token.estimate(input.header)
    breakdown.push({ label: "System Prompt", tokens: systemPromptTokens })

    const environmentTokens = Token.estimate(input.environment)
    breakdown.push({ label: "Environment", tokens: environmentTokens })

    const customRulesTokens = input.custom.reduce((sum, rule) => sum + Token.estimate(rule), 0)
    breakdown.push({ label: "Custom Rules", tokens: customRulesTokens })

    const totalTokens = breakdown.reduce((sum, item) => sum + item.tokens, 0)

    return {
      tokens: totalTokens,
      breakdown,
    }
  }

  export function estimateMessagesTokens(messages: Message[]): MessagesEstimate {
    let userTokens = 0
    let assistantTokens = 0

    for (const message of messages) {
      const tokens = Token.estimate(message.content)
      if (message.role === "user") {
        userTokens += tokens
      } else {
        assistantTokens += tokens
      }
    }

    return {
      userTokens,
      assistantTokens,
      totalTokens: userTokens + assistantTokens,
      messageCount: messages.length,
    }
  }

  export function estimateToolDefinitionsTokens(tools: ToolDefinition[]): ToolDefinitionsEstimate {
    if (tools.length === 0) {
      return { tokens: 0, count: 0 }
    }

    const totalTokens = tools.reduce((sum, tool) => {
      return sum + Token.estimate(tool.name) + Token.estimate(tool.description) + Token.estimate(tool.schema)
    }, 0)

    return {
      tokens: totalTokens,
      count: tools.length,
    }
  }

  export function buildReport(input: ReportInput): Report {
    const totalTokens =
      input.systemPromptTokens + input.userMessageTokens + input.assistantMessageTokens + input.toolDefinitionTokens

    const usagePercent = totalTokens / input.contextLimit

    const segments: Segment[] = [
      {
        label: "System Prompt",
        tokens: input.systemPromptTokens,
        percent: input.systemPromptTokens / input.contextLimit,
      },
      {
        label: "User Messages",
        tokens: input.userMessageTokens,
        percent: input.userMessageTokens / input.contextLimit,
      },
      {
        label: "Assistant Messages",
        tokens: input.assistantMessageTokens,
        percent: input.assistantMessageTokens / input.contextLimit,
      },
      {
        label: "Tool Definitions",
        tokens: input.toolDefinitionTokens,
        percent: input.toolDefinitionTokens / input.contextLimit,
      },
    ]

    return {
      modelID: input.modelID,
      contextLimit: input.contextLimit,
      totalTokens,
      usagePercent,
      segments,
      generatedAt: new Date(),
    }
  }
}

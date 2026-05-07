/**
 * OpenCode → YunPat LLM 适配器
 *
 * 使用 fetch 调用 OpenAI-compatible API（DeepSeek/Qwen/GLM 等均兼容）。
 * 通过插件配置传入 API 信息，不依赖 OpenCode SDK client 的 model 属性。
 */

export interface OpenCodeLLMConfig {
  /** API Base URL（如 https://api.deepseek.com/v1） */
  baseUrl: string
  /** API Key */
  apiKey: string
  /** 默认模型 ID */
  modelId?: string
  /** 温度 */
  temperature?: number
  /** 最大 token */
  maxTokens?: number
}

/**
 * OpenCode LLM 适配器
 *
 * 使用 fetch 直接调用 OpenAI-compatible chat API，
 * 兼容 DeepSeek、Qwen、GLM、OpenAI 等模型。
 */
export class OpenCodeLLMAdapter {
  private config: OpenCodeLLMConfig

  constructor(config: OpenCodeLLMConfig) {
    this.config = config
  }

  /**
   * 单次聊天调用
   */
  async chat(params: {
    messages: Array<{ role: string; content: string }>
    temperature?: number
    maxTokens?: number
    model?: string
  }): Promise<{
    message: { role: string; content: string }
    content: string
    usage?: { promptTokens: number; completionTokens: number }
    model?: string
  }> {
    const { baseUrl, apiKey, modelId, temperature, maxTokens } = this.config

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model ?? modelId ?? "deepseek-chat",
        messages: params.messages.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        })),
        temperature: params.temperature ?? temperature ?? 0.3,
        max_tokens: params.maxTokens ?? maxTokens ?? 4096,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error")
      throw new Error(`LLM API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content ?? ""

    return {
      message: {
        role: "assistant" as const,
        content,
      },
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
      model: data.model,
    }
  }

  /**
   * 嵌入向量
   */
  async embed(texts: string[]): Promise<number[][]> {
    const { baseUrl, apiKey } = this.config

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-v3",
        input: texts,
      }),
    })

    if (!response.ok) {
      throw new Error(`Embedding API error (${response.status})`)
    }

    const data = await response.json() as any
    return (data.data ?? []).map((d: any) => d.embedding as number[])
  }

  /** 检查适配器是否可用 */
  get isAvailable(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey)
  }
}

/**
 * 创建默认 LLM 适配器
 *
 * 从插件 options 或环境变量获取配置：
 * - llm.baseUrl / LLM_BASE_URL
 * - llm.apiKey / LLM_API_KEY
 * - llm.model / LLM_MODEL
 */
export function createDefaultLLM(
  _client: any,
  options?: Record<string, unknown>,
): OpenCodeLLMAdapter {
  const baseUrl =
    (options?.baseUrl as string) ??
    (options?.llm as Record<string, unknown>)?.baseUrl as string ??
    process.env.LLM_BASE_URL ??
    ""

  const apiKey =
    (options?.apiKey as string) ??
    (options?.llm as Record<string, unknown>)?.apiKey as string ??
    process.env.LLM_API_KEY ??
    ""

  const modelId =
    (options?.model as string) ??
    (options?.llm as Record<string, unknown>)?.model as string ??
    process.env.LLM_MODEL ??
    undefined

  return new OpenCodeLLMAdapter({
    baseUrl,
    apiKey,
    modelId,
    temperature: 0.3,
    maxTokens: 4096,
  })
}

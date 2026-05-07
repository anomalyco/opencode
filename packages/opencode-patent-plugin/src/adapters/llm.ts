/**
 * OpenCode → YunPat LLM 适配器
 *
 * 使用 fetch 调用 OpenAI-compatible API（DeepSeek/Qwen/GLM 等均兼容）。
 * 通过插件配置传入 API 信息，不依赖 OpenCode SDK client 的 model 属性。
 *
 * v2: 新增重试（指数退避）+ 超时保护（30s）
 */

import { withRetry } from "../utils/retry.js"

/** LLM 请求超时（ms） */
const LLM_TIMEOUT = 30_000

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

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
   * 单次聊天调用（带重试 + 超时）
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
    return withRetry(
      async () => {
        const { baseUrl, apiKey, modelId, temperature, maxTokens } = this.config

        // AbortController 超时保护
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT)

        try {
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
            signal: controller.signal,
          })

          if (!response.ok) {
            const errorText = await response.text().catch(() => "unknown error")
            const error: any = new Error(`LLM API error (${response.status}): ${errorText}`)
            error.status = response.status
            throw error
          }

          const data = (await response.json()) as any
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
        } catch (err: any) {
          // AbortError 转为更友好的消息
          if (err?.name === "AbortError") {
            throw new Error(`LLM API timeout (${LLM_TIMEOUT / 1000}s)`)
          }
          throw err
        } finally {
          clearTimeout(timeoutId)
        }
      },
      {
        maxRetries: 2,
        retryable: (err) => RETRYABLE_STATUSES.has(err?.status) ||
          /timeout|ECONNREFUSED|ECONNRESET|fetch failed/i.test(err?.message || ""),
      },
    )
  }

  /**
   * 嵌入向量（带超时）
   */
  async embed(texts: string[]): Promise<number[][]> {
    const { baseUrl, apiKey } = this.config

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT)

    try {
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
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Embedding API error (${response.status})`)
      }

      const data = (await response.json()) as any
      return (data.data ?? []).map((d: any) => d.embedding as number[])
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`Embedding API timeout (${LLM_TIMEOUT / 1000}s)`)
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
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
    ((options?.llm as Record<string, unknown>)?.baseUrl as string) ??
    process.env.LLM_BASE_URL ??
    ""

  const apiKey =
    (options?.apiKey as string) ??
    ((options?.llm as Record<string, unknown>)?.apiKey as string) ??
    process.env.LLM_API_KEY ??
    ""

  const modelId =
    (options?.model as string) ??
    ((options?.llm as Record<string, unknown>)?.model as string) ??
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

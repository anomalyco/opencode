/**
 * OpenCode → YunPat LLM 适配器
 *
 * 将 OpenCode 的模型调用桥接到 YunPat 的 LLMAdapter 接口
 */

import type { LLMAdapter, ChatParams, ChatResponse, ChatChunk } from "@yunpat/core"

export interface OpenCodeLLMConfig {
  /** OpenCode SDK 客户端 */
  client: any
  /** 默认模型 ID */
  modelId?: string
  /** 默认 Provider ID */
  providerId?: string
  /** 温度 */
  temperature?: number
  /** 最大 token */
  maxTokens?: number
}

/**
 * OpenCode LLM 适配器
 *
 * 将 OpenCode 的 chat API 适配为 YunPat 的 LLMAdapter 接口
 */
export class OpenCodeLLMAdapter implements LLMAdapter {
  private config: OpenCodeLLMConfig

  constructor(config: OpenCodeLLMConfig) {
    this.config = config
  }

  /**
   * 单次聊天调用
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    const { client, modelId, providerId, temperature, maxTokens } = this.config

    // 构建 OpenCode 消息格式
    const messages = params.messages.map((msg) => ({
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
    }))

    // 调用 OpenCode SDK
    let model = client.model
    if (providerId) model = model.withProvider(providerId)
    if (modelId) model = model.withModel(modelId)

    const response = await model.chat({
      messages,
      temperature: temperature ?? 0.3,
      maxTokens: maxTokens ?? 4096,
    })

    // 转换为 YunPat 格式
    return {
      content: response.content ?? "",
      usage: response.usage,
      model: response.model,
    }
  }

  /**
   * 流式聊天调用
   */
  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const { client, modelId, providerId, temperature, maxTokens } = this.config

    const messages = params.messages.map((msg) => ({
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
    }))

    let model = client.model
    if (providerId) model = model.withProvider(providerId)
    if (modelId) model = model.withModel(modelId)

    const stream = await model.chatStream({
      messages,
      temperature: temperature ?? 0.3,
      maxTokens: maxTokens ?? 4096,
    })

    for await (const chunk of stream) {
      yield {
        content: chunk.content ?? "",
        done: chunk.done ?? false,
      }
    }
  }

  /**
   * 嵌入向量
   */
  async embed(texts: string[]): Promise<number[][]> {
    const { client } = this.config
    const response = await client.model.embed({ texts })
    return response.embeddings
  }
}

/**
 * 创建默认 LLM 适配器
 */
export function createDefaultLLM(client: any, options?: Partial<OpenCodeLLMConfig>): OpenCodeLLMAdapter {
  return new OpenCodeLLMAdapter({
    client,
    temperature: 0.3,
    maxTokens: 4096,
    ...options,
  })
}

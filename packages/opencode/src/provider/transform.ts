/**
 * ============================================================================
 * 文件名：transform.ts
 * 所属包：packages/opencode/src/provider
 * ============================================================================
 *
 * 文件作用：
 * 提供商转换模块。处理不同 AI 提供商之间的消息格式、参数和选项转换。
 *
 * 主要功能：
 * - message(msgs, model)：转换消息格式以适配不同提供商
 * - temperature(model)：获取模型推荐的温度参数
 * - topP(model)：获取模型推荐的 top_p 参数
 * - topK(model)：获取模型推荐的 top_k 参数
 * - variants(model)：生成推理模型的变体配置
 * - options(model, sessionID)：生成提供商特定选项
 * - smallOptions(model)：生成小型模型的选项
 * - providerOptions(model, options)：包装提供商选项
 * - maxOutputTokens(npm, options, modelLimit, globalLimit)：计算最大输出 tokens
 * - schema(model, schema)：转换 JSON Schema 以适配提供商
 * - error(providerID, error)：转换错误消息
 *
 * 依赖关系：
 * - ai：Vercel AI SDK 类型定义
 * - remeda：工具函数
 * - zod：JSON Schema 类型
 * - ./provider：提供商类型定义
 * - ./models：Models.dev 类型定义
 * - ../util/iife：立即执行函数表达式工具
 *
 * 导出内容：
 * - ProviderTransform namespace：提供商转换命名空间
 *   - message()：消息格式转换
 *   - temperature()：温度参数
 *   - topP()：top_p 参数
 *   - topK()：top_k 参数
 *   - variants()：模型变体
 *   - options()：提供商选项
 *   - smallOptions()：小型模型选项
 *   - providerOptions()：提供商选项包装
 *   - maxOutputTokens()：最大输出 tokens
 *   - schema()：Schema 转换
 *   - error()：错误消息转换
 *
 * 转换场景：
 * 1. 消息格式：不同提供商对消息格式有不同要求
 * 2. 推理参数：推理模型的 effort/budget 配置
 * 3. 缓存控制：prompt caching 的实现方式
 * 4. 工具调用：tool call ID 的格式要求
 * 5. Schema 转换：JSON Schema 的适配
 *
 * 使用示例：
 * ```typescript
 * // 转换消息格式
 * const messages = ProviderTransform.message(rawMessages, model)
 *
 * // 获取推荐的温度参数
 * const temp = ProviderTransform.temperature(model)
 *
 * // 生成推理变体配置
 * const variants = ProviderTransform.variants(model)
 * // { high: { thinking: { budgetTokens: 16000 } } }
 * ```
 *
 * @package opencode
 * @module provider/transform
 */

// 导入 AI SDK 类型
import type { APICallError, ModelMessage } from "ai"

// 导入 remeda 工具函数
import { unique } from "remeda"

// 导入 JSON Schema 类型
import type { JSONSchema } from "zod/v4/core"

// 导入提供商类型
import type { Provider } from "./provider"

// 导入 Models.dev 类型
import type { ModelsDev } from "./models"

// 导入 IIFE 工具
import { iife } from "@/util/iife"

/**
 * 模态类型
 *
 * 定义模型支持的输入/输出类型。
 */
type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

/**
 * 将 MIME 类型转换为模态类型
 *
 * @param mime - MIME 类型字符串
 * @returns 对应的模态类型，如果不支持返回 undefined
 */
function mimeToModality(mime: string): Modality | undefined {
  // 图片类型
  if (mime.startsWith("image/")) return "image"
  // 音频类型
  if (mime.startsWith("audio/")) return "audio"
  // 视频类型
  if (mime.startsWith("video/")) return "video"
  // PDF 类型
  if (mime === "application/pdf") return "pdf"
  return undefined
}

/**
 * 提供商转换命名空间
 *
 * 处理不同 AI 提供商之间的格式和参数转换。
 */
export namespace ProviderTransform {
  /**
   * 规范化消息格式
   *
   * 根据提供商要求调整消息格式。
   *
   * @param msgs - 原始消息列表
   * @param model - 模型信息
   * @returns 转换后的消息列表
   *
   * 处理的转换：
   * - Anthropic：移除空文本，过滤空内容
   * - Claude：规范化 tool call ID（只保留字母数字和下划线）
   * - Mistral：规范化 tool call ID 为 9 位字母数字
   * - 推理模型：提取 reasoning_content 到 providerOptions
   */
  function normalizeMessages(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    // Anthropic 拒绝空内容的消息 - 过滤空字符串消息
    // 并从数组内容中移除空的 text/reasoning 部分
    if (model.api.npm === "@ai-sdk/anthropic") {
      msgs = msgs
        .map((msg) => {
          // 处理字符串内容
          if (typeof msg.content === "string") {
            if (msg.content === "") return undefined
            return msg
          }
          // 不是数组内容，直接返回
          if (!Array.isArray(msg.content)) return msg
          // 过滤数组中的空内容
          const filtered = msg.content.filter((part) => {
            if (part.type === "text" || part.type === "reasoning") {
              return part.text !== ""
            }
            return true
          })
          // 如果过滤后为空，返回 undefined
          if (filtered.length === 0) return undefined
          return { ...msg, content: filtered }
        })
        .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
    }

    // Claude 模型：规范化 tool call ID
    if (model.api.id.includes("claude")) {
      return msgs.map((msg) => {
        // 只处理 assistant 和 tool 角色的数组内容
        if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
          msg.content = msg.content.map((part) => {
            // 规范化 tool call ID
            if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
              return {
                ...part,
                // 只保留字母数字、下划线和连字符
                toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
              }
            }
            return part
          })
        }
        return msg
      })
    }

    // Mistral 模型：特殊处理
    if (model.providerID === "mistral" || model.api.id.toLowerCase().includes("mistral")) {
      const result: ModelMessage[] = []
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i]
        const nextMsg = msgs[i + 1]

        // 规范化 tool call ID 为 9 位字母数字
        if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
          msg.content = msg.content.map((part) => {
            if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
              // Mistral 需要恰好 9 个字符的字母数字 ID
              const normalizedId = part.toolCallId
                .replace(/[^a-zA-Z0-9]/g, "") // 移除非字母数字字符
                .substring(0, 9) // 取前 9 个字符
                .padEnd(9, "0") // 如果不足 9 位，用零填充

              return {
                ...part,
                toolCallId: normalizedId,
              }
            }
            return part
          })
        }

        result.push(msg)

        // 修复消息顺序：tool 消息后不能直接跟 user 消息
        if (msg.role === "tool" && nextMsg?.role === "user") {
          result.push({
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Done.",
              },
            ],
          })
        }
      }
      return result
    }

    // 推理模型：提取 reasoning_content 到 providerOptions
    if (
      model.capabilities.interleaved &&
      typeof model.capabilities.interleaved === "object" &&
      model.capabilities.interleaved.field === "reasoning_content"
    ) {
      return msgs.map((msg) => {
        // 只处理 assistant 角色的数组内容
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          // 提取所有 reasoning 部分
          const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
          const reasoningText = reasoningParts.map((part: any) => part.text).join("")

          // 从内容中过滤掉 reasoning 部分
          const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

          // 将 reasoning_content 直接放在消息的 providerOptions 中
          if (reasoningText) {
            return {
              ...msg,
              content: filteredContent,
              providerOptions: {
                ...msg.providerOptions,
                openaiCompatible: {
                  ...(msg.providerOptions as any)?.openaiCompatible,
                  reasoning_content: reasoningText,
                },
              },
            }
          }

          return {
            ...msg,
            content: filteredContent,
          }
        }

        return msg
      })
    }

    return msgs
  }

  /**
   * 应用缓存控制
   *
   * 为支持 prompt caching 的提供商添加缓存标记。
   *
   * @param msgs - 消息列表
   * @param providerID - 提供商 ID
   * @returns 添加缓存标记后的消息列表
   *
   * 缓存策略：
   * - 前 2 条 system 消息
   * - 最后 2 条非 system 消息
   */
  function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
    // 获取前 2 条 system 消息
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    // 获取最后 2 条非 system 消息
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

    // 各提供商的缓存控制配置
    const providerOptions = {
      // Anthropic 的缓存控制
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      // OpenRouter 的缓存控制
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
      // Bedrock 的缓存控制
      bedrock: {
        cachePoint: { type: "ephemeral" },
      },
      // OpenAI 兼容的缓存控制
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
    }

    // 为需要缓存的消息添加标记
    for (const msg of unique([...system, ...final])) {
      // 对于非 Anthropic 提供商，如果是数组内容，将标记添加到最后一个内容块
      const shouldUseContentOptions = providerID !== "anthropic" && Array.isArray(msg.content) && msg.content.length > 0

      if (shouldUseContentOptions) {
        const lastContent = msg.content[msg.content.length - 1]
        if (lastContent && typeof lastContent === "object") {
          lastContent.providerOptions = {
            ...lastContent.providerOptions,
            ...providerOptions,
          }
          continue
        }
      }

      // 将标记添加到消息级别
      msg.providerOptions = {
        ...msg.providerOptions,
        ...providerOptions,
      }
    }

    return msgs
  }

  /**
   * 处理不支持的内容类型
   *
   * 将模型不支持的内容类型转换为错误文本。
   *
   * @param msgs - 消息列表
   * @param model - 模型信息
   * @returns 处理后的消息列表
   *
   * 检查项目：
   * - 空的 base64 图片数据
   * - 不支持的模态类型
   */
  function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    return msgs.map((msg) => {
      // 只处理 user 角色的数组内容
      if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

      // 映射并过滤内容
      const filtered = msg.content.map((part) => {
        // 只处理文件和图片
        if (part.type !== "file" && part.type !== "image") return part

        // 检查空的 base64 图片数据
        if (part.type === "image") {
          const imageStr = part.image.toString()
          if (imageStr.startsWith("data:")) {
            // 匹配 data URL 格式
            const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
            if (match && (!match[2] || match[2].length === 0)) {
              return {
                type: "text" as const,
                text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
              }
            }
          }
        }

        // 获取 MIME 类型和模态类型
        const mime = part.type === "image" ? part.image.toString().split(";")[0].replace("data:", "") : part.mediaType
        const filename = part.type === "file" ? part.filename : undefined
        const modality = mimeToModality(mime)

        // 如果不是支持的模态，保持原样
        if (!modality) return part

        // 检查模型是否支持该模态
        if (model.capabilities.input[modality]) return part

        // 转换为错误文本
        const name = filename ? `"${filename}"` : modality
        return {
          type: "text" as const,
          text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
        }
      })

      return { ...msg, content: filtered }
    })
  }

  /**
   * 转换消息格式
   *
   * 对消息进行完整的格式转换。
   *
   * @param msgs - 原始消息列表
   * @param model - 模型信息
   * @returns 转换后的消息列表
   *
   * 转换步骤：
   * 1. 处理不支持的内容类型
   * 2. 规范化消息格式
   * 3. 为 Anthropic 添加缓存控制
   */
  export function message(msgs: ModelMessage[], model: Provider.Model) {
    // 处理不支持的内容
    msgs = unsupportedParts(msgs, model)
    // 规范化消息格式
    msgs = normalizeMessages(msgs, model)
    // 为 Anthropic 添加缓存控制
    if (
      model.providerID === "anthropic" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.api.npm === "@ai-sdk/anthropic"
    ) {
      msgs = applyCaching(msgs, model.providerID)
    }

    return msgs
  }

  /**
   * 获取推荐的温度参数
   *
   * 根据模型返回推荐的温度值。
   *
   * @param model - 模型信息
   * @returns 推荐的温度值，undefined 表示使用默认
   */
  export function temperature(model: Provider.Model) {
    const id = model.id.toLowerCase()
    // Qwen 模型推荐 0.55
    if (id.includes("qwen")) return 0.55
    // Claude 不设置温度
    if (id.includes("claude")) return undefined
    // Gemini 推荐 1.0
    if (id.includes("gemini")) return 1.0
    // GLM 4.6/4.7 推荐 1.0
    if (id.includes("glm-4.6")) return 1.0
    if (id.includes("glm-4.7")) return 1.0
    // MiniMax M2 推荐 1.0
    if (id.includes("minimax-m2")) return 1.0
    // Kimi K2 模型
    if (id.includes("kimi-k2")) {
      if (id.includes("thinking")) return 1.0
      return 0.6
    }
    return undefined
  }

  /**
   * 获取推荐的 top_p 参数
   *
   * @param model - 模型信息
   * @returns 推荐的 top_p 值
   */
  export function topP(model: Provider.Model) {
    const id = model.id.toLowerCase()
    // Qwen 推荐 1.0
    if (id.includes("qwen")) return 1
    // MiniMax M2 推荐 0.95
    if (id.includes("minimax-m2")) {
      return 0.95
    }
    // Gemini 推荐 0.95
    if (id.includes("gemini")) return 0.95
    return undefined
  }

  /**
   * 获取推荐的 top_k 参数
   *
   * @param model - 模型信息
   * @returns 推荐的 top_k 值
   */
  export function topK(model: Provider.Model) {
    const id = model.id.toLowerCase()
    // MiniMax M2 模型
    if (id.includes("minimax-m2")) {
      if (id.includes("m2.1")) return 40
      return 20
    }
    // Gemini 推荐 64
    if (id.includes("gemini")) return 64
    return undefined
  }

  // 广泛支持的推理级别
  const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
  // OpenAI 支持的推理级别
  const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

  /**
   * 生成模型变体配置
   *
   * 为推理模型生成不同 effort 级别的配置。
   *
   * @param model - 模型信息
   * @returns 变体 ID 到配置的映射
   *
   * 变体类型：
   * - reasoning_effort：推理强度
   * - thinking：思考模式
   * - budget_tokens：预算 tokens
   */
  export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    // 只处理支持推理的模型
    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()
    // 这些提供商不支持变体
    if (id.includes("deepseek") || id.includes("minimax") || id.includes("glm") || id.includes("mistral")) return {}

    // 根据 npm 包生成不同的变体配置
    switch (model.api.npm) {
      // OpenRouter 提供商
      case "@openrouter/ai-sdk-provider":
        // 只为特定模型生成变体
        if (!model.id.includes("gpt") && !model.id.includes("gemini-3") && !model.id.includes("grok-4")) return {}
        return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))

      // Vercel AI Gateway（注意：不能同时设置 max_tokens）
      case "@ai-sdk/gateway":
        return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      // Cerebras、TogetherAI、xAI、DeepInfra、OpenAI 兼容
      case "@ai-sdk/cerebras":
      case "@ai-sdk/togetherai":
      case "@ai-sdk/xai":
      case "@ai-sdk/deepinfra":
      case "@ai-sdk/openai-compatible":
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      // Azure OpenAI
      case "@ai-sdk/azure":
        // o1-mini 不支持变体
        if (id === "o1-mini") return {}
        const azureEfforts = ["low", "medium", "high"]
        // GPT-5 系列添加 minimal 级别
        if (id.includes("gpt-5-") || id === "gpt-5") {
          azureEfforts.unshift("minimal")
        }
        return Object.fromEntries(
          azureEfforts.map((effort) => [
            effort,
            {
              reasoningEffort: effort,
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          ]),
        )

      // OpenAI
      case "@ai-sdk/openai":
        // gpt-5-pro 不支持变体
        if (id === "gpt-5-pro") return {}
        const openaiEfforts = iife(() => {
          // Codex 模型
          if (id.includes("codex")) {
            if (id.includes("5.2")) return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
            return WIDELY_SUPPORTED_EFFORTS
          }
          const arr = [...WIDELY_SUPPORTED_EFFORTS]
          // GPT-5 系列添加 minimal 级别
          if (id.includes("gpt-5-") || id === "gpt-5") {
            arr.unshift("minimal")
          }
          // 2025-11-13 后发布的模型支持 none 级别
          if (model.release_date >= "2025-11-13") {
            arr.unshift("none")
          }
          // 2025-12-04 后发布的模型支持 xhigh 级别
          if (model.release_date >= "2025-12-04") {
            arr.push("xhigh")
          }
          return arr
        })
        return Object.fromEntries(
          openaiEfforts.map((effort) => [
            effort,
            {
              reasoningEffort: effort,
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          ]),
        )

      // Anthropic Claude
      case "@ai-sdk/anthropic":
        return {
          high: {
            thinking: {
              type: "enabled",
              budgetTokens: 16000,
            },
          },
          max: {
            thinking: {
              type: "enabled",
              budgetTokens: 31999,
            },
          },
        }

      // Amazon Bedrock
      case "@ai-sdk/amazon-bedrock":
        // Bedrock 上的 Anthropic 模型使用 reasoningConfig
        if (model.api.id.includes("anthropic")) {
          return {
            high: {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: 16000,
              },
            },
            max: {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: 31999,
              },
            },
          }
        }

        // Amazon Nova 模型使用 maxReasoningEffort
        return Object.fromEntries(
          WIDELY_SUPPORTED_EFFORTS.map((effort) => [
            effort,
            {
              reasoningConfig: {
                type: "enabled",
                maxReasoningEffort: effort,
              },
            },
          ]),
        )

      // Google Vertex AI / Google Generative AI
      case "@ai-sdk/google-vertex":
      case "@ai-sdk/google":
        // Gemini 2.5 使用 thinkingBudget
        if (id.includes("2.5")) {
          return {
            high: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: 16000,
              },
            },
            max: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: 24576,
              },
            },
          }
        }
        // 其他模型使用 thinkingLevel
        return Object.fromEntries(
          ["low", "high"].map((effort) => [
            effort,
            {
              includeThoughts: true,
              thinkingLevel: effort,
            },
          ]),
        )

      // Mistral 不支持变体
      case "@ai-sdk/mistral":
        return {}

      // Cohere 不支持变体
      case "@ai-sdk/cohere":
        return {}

      // Groq
      case "@ai-sdk/groq":
        const groqEffort = ["none", ...WIDELY_SUPPORTED_EFFORTS]
        return Object.fromEntries(
          groqEffort.map((effort) => [
            effort,
            {
              includeThoughts: true,
              thinkingLevel: effort,
            },
          ]),
        )

      // Perplexity 不支持变体
      case "@ai-sdk/perplexity":
        return {}
    }
    return {}
  }

  /**
   * 生成提供商选项
   *
   * 根据模型和会话生成提供商特定的选项。
   *
   * @param model - 模型信息
   * @param sessionID - 会话 ID
   * @param providerOptions - 额外的提供商选项
   * @returns 提供商选项对象
   */
  export function options(
    model: Provider.Model,
    sessionID: string,
    providerOptions?: Record<string, any>,
  ): Record<string, any> {
    const result: Record<string, any> = {}

    // OpenRouter 特定配置
    if (model.api.npm === "@openrouter/ai-sdk-provider") {
      result["usage"] = {
        include: true,
      }
      // Gemini-3 默认使用高推理强度
      if (model.api.id.includes("gemini-3")) {
        result["reasoning"] = { effort: "high" }
      }
    }

    // Baseten 和 OpenCode 特定模型
    if (
      model.providerID === "baseten" ||
      (model.providerID === "opencode" && ["kimi-k2-thinking", "glm-4.6"].includes(model.api.id))
    ) {
      result["chat_template_args"] = { enable_thinking: true }
    }

    // Zai 和智谱 AI 的思考模式
    if (["zai", "zhipuai"].includes(model.providerID) && model.api.npm === "@ai-sdk/openai-compatible") {
      result["thinking"] = {
        type: "enabled",
        clear_thinking: false,
      }
    }

    // OpenAI 的缓存密钥
    if (model.providerID === "openai" || providerOptions?.setCacheKey) {
      result["promptCacheKey"] = sessionID
    }

    // Google 的思考配置
    if (model.api.npm === "@ai-sdk/google" || model.api.npm === "@ai-sdk/google-vertex") {
      result["thinkingConfig"] = {
        includeThoughts: true,
      }
      // Gemini-3 使用高推理强度
      if (model.api.id.includes("gemini-3")) {
        result["thinkingConfig"]["thinkingLevel"] = "high"
      }
    }

    // GPT-5 系列特定配置
    if (model.api.id.includes("gpt-5") && !model.api.id.includes("gpt-5-chat")) {
      // Codex 模型不存储对话
      if (model.providerID.includes("codex")) {
        result["store"] = false
      }

      // 非 Codex、非 Pro 模型使用中等推理强度
      if (!model.api.id.includes("codex") && !model.api.id.includes("gpt-5-pro")) {
        result["reasoningEffort"] = "medium"
      }

      // GPT-5 使用低冗长度
      if (model.api.id.endsWith("gpt-5.") && model.providerID !== "azure") {
        result["textVerbosity"] = "low"
      }

      // OpenCode 提供商的额外配置
      if (model.providerID.startsWith("opencode")) {
        result["promptCacheKey"] = sessionID
        result["include"] = ["reasoning.encrypted_content"]
        result["reasoningSummary"] = "auto"
      }
    }
    return result
  }

  /**
   * 生成小型模型选项
   *
   * 为快速操作生成低成本的推理配置。
   *
   * @param model - 模型信息
   * @returns 小型模型选项
   */
  export function smallOptions(model: Provider.Model) {
    // OpenAI / GPT-5
    if (model.providerID === "openai" || model.api.id.includes("gpt-5")) {
      if (model.api.id.includes("5.")) {
        return { reasoningEffort: "low" }
      }
      return { reasoningEffort: "minimal" }
    }
    // Google
    if (model.providerID === "google") {
      // Gemini-3 使用 thinkingLevel
      if (model.api.id.includes("gemini-3")) {
        return { thinkingConfig: { thinkingLevel: "minimal" } }
      }
      // Gemini 2.5 使用 thinkingBudget
      return { thinkingConfig: { thinkingBudget: 0 } }
    }
    // OpenRouter
    if (model.providerID === "openrouter") {
      if (model.api.id.includes("google")) {
        return { reasoning: { enabled: false } }
      }
      return { reasoningEffort: "minimal" }
    }
    return {}
  }

  /**
   * 包装提供商选项
   *
   * 将选项包装在提供商特定的命名空间中。
   *
   * @param model - 模型信息
   * @param options - 原始选项
   * @returns 包装后的选项
   */
  export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
    switch (model.api.npm) {
      // GitHub Copilot、OpenAI、Azure 使用 openai 命名空间
      case "@ai-sdk/github-copilot":
      case "@ai-sdk/openai":
      case "@ai-sdk/azure":
        return {
          ["openai" as string]: options,
        }
      // Amazon Bedrock 使用 bedrock 命名空间
      case "@ai-sdk/amazon-bedrock":
        return {
          ["bedrock" as string]: options,
        }
      // Anthropic 使用 anthropic 命名空间
      case "@ai-sdk/anthropic":
        return {
          ["anthropic" as string]: options,
        }
      // Google 使用 google 命名空间
      case "@ai-sdk/google-vertex":
      case "@ai-sdk/google":
        return {
          ["google" as string]: options,
        }
      // Vercel AI Gateway 使用 gateway 命名空间
      case "@ai-sdk/gateway":
        return {
          ["gateway" as string]: options,
        }
      // OpenRouter 使用 openrouter 命名空间
      case "@openrouter/ai-sdk-provider":
        return {
          ["openrouter" as string]: options,
        }
      default:
        // 其他提供商使用 providerID 作为命名空间
        return {
          [model.providerID]: options,
        }
    }
  }

  /**
   * 计算最大输出 tokens
   *
   * 考虑模型限制和全局限制，以及推理预算。
   *
   * @param npm - npm 包名
   * @param options - 提供商选项
   * @param modelLimit - 模型限制
   * @param globalLimit - 全局限制
   * @returns 最大输出 tokens
   */
  export function maxOutputTokens(
    npm: string,
    options: Record<string, any>,
    modelLimit: number,
    globalLimit: number,
  ): number {
    // 取模型限制和全局限制的较小值
    const modelCap = modelLimit || globalLimit
    const standardLimit = Math.min(modelCap, globalLimit)

    // Anthropic 特殊处理：考虑思考预算
    if (npm === "@ai-sdk/anthropic") {
      const thinking = options?.["thinking"]
      const budgetTokens = typeof thinking?.["budgetTokens"] === "number" ? thinking["budgetTokens"] : 0
      const enabled = thinking?.["type"] === "enabled"
      if (enabled && budgetTokens > 0) {
        // 返回文本 tokens，使得 text + thinking <= 模型上限，尽可能使用 32k 文本
        if (budgetTokens + standardLimit <= modelCap) {
          return standardLimit
        }
        return modelCap - budgetTokens
      }
    }

    return standardLimit
  }

  /**
   * 转换 JSON Schema
   *
   * 根据提供商要求调整 JSON Schema。
   *
   * @param model - 模型信息
   * @param schema - 原始 JSON Schema
   * @returns 转换后的 Schema
   *
   * 转换场景：
   * - Google/Gemini：将整数枚举转换为字符串枚举
   */
  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema) {
    /*
    // OpenAI/Azure 可选的转换（已注释）
    if (["openai", "azure"].includes(providerID)) {
      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (schema.required?.includes(key)) continue
          schema.properties[key] = {
            anyOf: [
              value as JSONSchema.JSONSchema,
              {
                type: "null",
              },
            ],
          }
        }
      }
    }
    */

    // Google/Gemini：将整数枚举转换为字符串枚举
    if (model.providerID === "google" || model.api.id.includes("gemini")) {
      const sanitizeGemini = (obj: any): any => {
        // 基本类型直接返回
        if (obj === null || typeof obj !== "object") {
          return obj
        }

        // 数组递归处理
        if (Array.isArray(obj)) {
          return obj.map(sanitizeGemini)
        }

        // 对象递归处理
        const result: any = {}
        for (const [key, value] of Object.entries(obj)) {
          // 转换枚举值为字符串
          if (key === "enum" && Array.isArray(value)) {
            result[key] = value.map((v) => String(v))
            // 如果是整数类型带枚举，改为字符串类型
            if (result.type === "integer" || result.type === "number") {
              result.type = "string"
            }
          } else if (typeof value === "object" && value !== null) {
            result[key] = sanitizeGemini(value)
          } else {
            result[key] = value
          }
        }

        // 过滤 required 数组，只包含存在于 properties 中的字段
        if (result.type === "object" && result.properties && Array.isArray(result.required)) {
          result.required = result.required.filter((field: any) => field in result.properties)
        }

        // 为数组添加空的 items 对象
        if (result.type === "array" && result.items == null) {
          result.items = {}
        }

        return result
      }

      schema = sanitizeGemini(schema)
    }

    return schema
  }

  /**
   * 转换错误消息
   *
   * 根据提供商添加额外的错误信息。
   *
   * @param providerID - 提供商 ID
   * @param error - 原始错误
   * @returns 转换后的错误消息
   */
  export function error(providerID: string, error: APICallError) {
    let message = error.message
    // GitHub Copilot 特殊提示
    if (providerID === "github-copilot" && message.includes("The requested model is not supported")) {
      return (
        message +
        "\n\nMake sure the model is enabled in your copilot settings: https://github.com/settings/copilot/features"
      )
    }

    return message
  }
}

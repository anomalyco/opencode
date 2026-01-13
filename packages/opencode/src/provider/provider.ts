/**
 * ============================================================================
 * 文件名：provider.ts
 * 所属包：packages/opencode/src/provider
 * ============================================================================
 *
 * 文件作用：
 * AI 提供商管理系统核心模块。负责加载、配置和管理所有 AI 提供商及其模型。
 *
 * 主要功能：
 * - BUNDLED_PROVIDERS：内置提供商 SDK 映射
 * - CUSTOM_LOADERS：自定义提供商加载器配置
 * - Model/Info Schema：模型和提供商的类型定义
 * - list()：获取所有可用提供商
 * - getModel(providerID, modelID)：获取指定模型
 * - getLanguage(model)：获取模型的 SDK 语言模型实例
 * - defaultModel()：获取默认模型
 * - getSmallModel(providerID)：获取小型模型
 * - sort(models)：模型排序
 *
 * 依赖关系：
 * - ../global：全局路径配置
 * - ../util/log：日志记录
 * - ../config/config：配置系统
 * - ../auth：认证信息存储
 * - ../env：环境变量读取
 * - ../project/instance：实例状态管理
 * - ../flag/flag：功能标志
 * - ../plugin：插件系统
 * - ../bun：Bun 运行时工具
 * - ./models：Models.dev API 集成
 * - ./transform：提供商转换工具
 * - ai：Vercel AI SDK
 *
 * 导出内容：
 * - Provider namespace：提供商管理命名空间
 *   - Model Schema：模型定义
 *   - Info Schema：提供商定义
 *   - list()：获取所有提供商
 *   - getModel()：获取指定模型
 *   - getLanguage()：获取 SDK 实例
 *   - defaultModel()：获取默认模型
 *   - getSmallModel()：获取小型模型
 *   - closest()：模糊匹配模型
 *   - sort()：模型排序
 *   - parseModel()：解析模型字符串
 *   - ModelNotFoundError：模型未找到错误
 *   - InitError：提供商初始化错误
 *
 * 提供商来源：
 * 1. models.dev API：从远程获取最新的提供商和模型信息
 * 2. 配置文件：用户自定义提供商配置
 * 3. 环境变量：通过环境变量配置 API Key
 * 4. 认证存储：用户通过 UI 设置的认证信息
 * 5. 插件：插件注册的提供商
 *
 * 自定义加载器：
 * 某些提供商需要特殊的初始化逻辑，如：
 * - anthropic：添加 beta 功能头
 * - amazon-bedrock：复杂的区域和凭证处理
 * - openai：使用 responses API
 * - azure-cognitive-services：自定义 baseURL
 *
 * 使用示例：
 * ```typescript
 * // 获取所有提供商
 * const providers = await Provider.list()
 *
 * // 获取指定模型
 * const model = await Provider.getModel("anthropic", "claude-sonnet-4-5")
 *
 * // 获取 SDK 语言模型实例
 * const languageModel = await Provider.getLanguage(model)
 *
 * // 获取默认模型
 * const defaultModel = await Provider.defaultModel()
 *
 * // 获取小型模型（用于快速操作）
 * const smallModel = await Provider.getSmallModel("anthropic")
 * ```
 *
 * @package opencode
 * @module provider/provider
 */

// 导入全局路径配置
import { Global } from "../global"

// 导入日志工具
import { Log } from "../util/log"

// 导入路径模块
import path from "path"

// 导入 Zod 用于运行时类型验证
import z from "zod"

// 导入编译时宏数据，包含内置的模型数据
import { data } from "./models-macro" with { type: "macro" }

// 导入安装管理模块
import { Installation } from "../installation"

// 导入功能标志
import { Flag } from "../flag/flag"

// ============================================================================
// Direct imports for bundled providers
// ============================================================================
// 直接导入内置提供商的 SDK，这些被打包到 opencode 中

// Amazon Bedrock 提供商
import { createAmazonBedrock, type AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"

// Anthropic (Claude) 提供商
import { createAnthropic } from "@ai-sdk/anthropic"

// Azure OpenAI 提供商
import { createAzure } from "@ai-sdk/azure"

// Google Generative AI 提供商
import { createGoogleGenerativeAI } from "@ai-sdk/google"

// Google Vertex AI 提供商
import { createVertex } from "@ai-sdk/google-vertex"

// Google Vertex AI 上的 Anthropic Claude
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"

// OpenAI 提供商
import { createOpenAI } from "@ai-sdk/openai"

// OpenAI 兼容提供商
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

// OpenRouter 提供商，聚合多个 AI 服务
import { createOpenRouter, type LanguageModelV2 } from "@openrouter/ai-sdk-provider"

// GitHub Copilot OpenAI 兼容提供商
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/openai-compatible/src"

// xAI (Grok) 提供商
import { createXai } from "@ai-sdk/xai"

// Mistral AI 提供商
import { createMistral } from "@ai-sdk/mistral"

// Groq 提供商
import { createGroq } from "@ai-sdk/groq"

// DeepInfra 提供商
import { createDeepInfra } from "@ai-sdk/deepinfra"

// Cerebras 提供商
import { createCerebras } from "@ai-sdk/cerebras"

// Cohere 提供商
import { createCohere } from "@ai-sdk/cohere"

// Vercel AI Gateway 提供商
import { createGateway } from "@ai-sdk/gateway"

// Together AI 提供商
import { createTogetherAI } from "@ai-sdk/togetherai"

// Perplexity AI 提供商
import { createPerplexity } from "@ai-sdk/perplexity"

// Vercel AI SDK 提供商
import { createVercel } from "@ai-sdk/vercel"

// 导入提供商转换工具
import { ProviderTransform } from "./transform"

/**
 * 提供商管理命名空间
 *
 * 负责加载、配置和管理所有 AI 提供商及其模型。
 */
export namespace Provider {
  // 创建日志记录器
  const log = Log.create({ service: "provider" })

  /**
   * 内置提供商 SDK 映射
   *
   * 将 npm 包名映射到对应的创建函数。
   * 这些提供商被打包到 opencode 中，不需要额外安装。
   */
  const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
    // Amazon Bedrock
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    // Anthropic Claude
    "@ai-sdk/anthropic": createAnthropic,
    // Azure OpenAI
    "@ai-sdk/azure": createAzure,
    // Google Generative AI (Gemini)
    "@ai-sdk/google": createGoogleGenerativeAI,
    // Google Vertex AI
    "@ai-sdk/google-vertex": createVertex,
    // Google Vertex AI 上的 Anthropic Claude
    "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
    // OpenAI
    "@ai-sdk/openai": createOpenAI,
    // OpenAI 兼容 API
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    // OpenRouter 聚合服务
    "@openrouter/ai-sdk-provider": createOpenRouter,
    // xAI (Grok)
    "@ai-sdk/xai": createXai,
    // Mistral AI
    "@ai-sdk/mistral": createMistral,
    // Groq
    "@ai-sdk/groq": createGroq,
    // DeepInfra
    "@ai-sdk/deepinfra": createDeepInfra,
    // Cerebras
    "@ai-sdk/cerebras": createCerebras,
    // Cohere
    "@ai-sdk/cohere": createCohere,
    // Vercel AI Gateway
    "@ai-sdk/gateway": createGateway,
    // Together AI
    "@ai-sdk/togetherai": createTogetherAI,
    // Perplexity AI
    "@ai-sdk/perplexity": createPerplexity,
    // Vercel AI SDK
    "@ai-sdk/vercel": createVercel,
    // GitHub Copilot (TODO: 移除此代码以减少维护成本)
    // @ts-ignore
    "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
  }

  /**
   * 自定义模型加载器类型
   *
   * 用于加载非标准模型（如 OpenAI Responses API）。
   */
  type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>

  /**
   * 自定义加载器类型
   *
   * 定义提供商的自定义初始化逻辑。
   */
  type CustomLoader = (provider: Info) => Promise<{
    // 是否自动加载（无需 API Key 也可加载）
    autoload: boolean
    // 可选的自定义模型加载函数
    getModel?: CustomModelLoader
    // 提供商选项
    options?: Record<string, any>
  }>

  /**
   * 自定义加载器配置
   *
   * 为需要特殊处理的提供商提供自定义加载逻辑。
   */
  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    /**
     * Anthropic 自定义加载器
     *
     * 添加 beta 功能头以启用实验性功能。
     */
    async anthropic() {
      return {
        // 不自动加载，需要 API Key
        autoload: false,
        options: {
          headers: {
            // 启用多个 beta 功能
            "anthropic-beta":
              "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          },
        },
      }
    },

    /**
     * OpenCode 自定义加载器
     *
     * 如果没有 API Key，只显示免费模型。
     */
    async opencode(input) {
      // 检查是否有 API Key
      const hasKey = await (async () => {
        const env = Env.all()
        // 检查环境变量
        if (input.env.some((item) => env[item])) return true
        // 检查认证存储
        if (await Auth.get(input.id)) return true
        // 检查配置文件
        const config = await Config.get()
        if (config.provider?.["opencode"]?.options?.apiKey) return true
        return false
      })()

      // 如果没有 API Key，移除所有付费模型
      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) continue
          delete input.models[key]
        }
      }

      return {
        // 如果还有模型则自动加载
        autoload: Object.keys(input.models).length > 0,
        options: hasKey ? {} : { apiKey: "public" },
      }
    },

    /**
     * OpenAI 自定义加载器
     *
     * 使用 Responses API 而非 Chat Completions API。
     */
    openai: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          // 使用 responses API
          return sdk.responses(modelID)
        },
        options: {},
      }
    },

    /**
     * GitHub Copilot 自定义加载器
     *
     * 根据模型名称选择 responses 或 chat API。
     */
    "github-copilot": async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          // Codex 模型使用 responses API
          if (modelID.includes("codex")) {
            return sdk.responses(modelID)
          }
          // 其他模型使用 chat API
          return sdk.chat(modelID)
        },
        options: {},
      }
    },

    /**
     * GitHub Copilot Enterprise 自定义加载器
     *
     * 与标准 Copilot 相同的 API 选择逻辑。
     */
    "github-copilot-enterprise": async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (modelID.includes("codex")) {
            return sdk.responses(modelID)
          }
          return sdk.chat(modelID)
        },
        options: {},
      }
    },

    /**
     * Azure 自定义加载器
     *
     * 根据 useCompletionUrls 选项选择 API。
     */
    azure: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {},
      }
    },

    /**
     * Azure Cognitive Services 自定义加载器
     *
     * 支持自定义资源名称和 baseURL。
     */
    "azure-cognitive-services": async () => {
      // 从环境变量获取资源名称
      const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {
          // 构造自定义 baseURL
          baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
        },
      }
    },

    /**
     * Amazon Bedrock 自定义加载器
     *
     * 处理复杂的区域、凭证和模型 ID 前缀逻辑。
     */
    "amazon-bedrock": async () => {
      const config = await Config.get()
      const providerConfig = config.provider?.["amazon-bedrock"]

      // 获取认证信息
      const auth = await Auth.get("amazon-bedrock")

      // 区域优先级：1) 配置文件 2) 环境变量 3) 默认
      const configRegion = providerConfig?.options?.region
      const envRegion = Env.get("AWS_REGION")
      const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

      // Profile：配置文件优先于环境变量
      const configProfile = providerConfig?.options?.profile
      const envProfile = Env.get("AWS_PROFILE")
      const profile = configProfile ?? envProfile

      // 获取 AWS Access Key ID
      const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID")

      // 获取 AWS Bearer Token
      const awsBearerToken = iife(() => {
        const envToken = Env.get("AWS_BEARER_TOKEN_BEDROCK")
        if (envToken) return envToken
        if (auth?.type === "api") {
          Env.set("AWS_BEARER_TOKEN_BEDROCK", auth.key)
          return auth.key
        }
        return undefined
      })

      // 如果没有凭证信息，不自动加载
      if (!profile && !awsAccessKeyId && !awsBearerToken) return { autoload: false }

      // 动态导入 AWS 凭证提供程序
      const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))

      // 构建凭证提供程序选项（仅在指定时传递 profile）
      const credentialProviderOptions = profile ? { profile } : {}

      // 构建提供商选项
      const providerOptions: AmazonBedrockProviderSettings = {
        region: defaultRegion,
        credentialProvider: fromNodeProviderChain(credentialProviderOptions),
      }

      // 添加自定义端点（endpoint 优先于 baseURL）
      const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
      if (endpoint) {
        providerOptions.baseURL = endpoint
      }

      return {
        autoload: true,
        options: providerOptions,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          // 如果模型已有跨区域推理配置文件前缀，跳过区域前缀
          if (modelID.startsWith("global.") || modelID.startsWith("jp.")) {
            return sdk.languageModel(modelID)
          }

          // 区域解析优先级（从高到低）：
          // 1. opencode.json provider config 中的 options.region
          // 2. AWS_REGION 环境变量
          // 3. 默认 "us-east-1"（已在 defaultRegion 中）
          const region = options?.region ?? defaultRegion

          // 获取区域前缀（如 us-east-1 -> us）
          let regionPrefix = region.split("-")[0]

          // 根据区域添加模型 ID 前缀
          switch (regionPrefix) {
            case "us": {
              // 需要前缀的模型列表
              const modelRequiresPrefix = [
                "nova-micro",
                "nova-lite",
                "nova-pro",
                "nova-premier",
                "nova-2",
                "claude",
                "deepseek",
              ].some((m) => modelID.includes(m))
              // AWS GovCloud 不添加前缀
              const isGovCloud = region.startsWith("us-gov")
              if (modelRequiresPrefix && !isGovCloud) {
                modelID = `${regionPrefix}.${modelID}`
              }
              break
            }
            case "eu": {
              // 需要前缀的区域列表
              const regionRequiresPrefix = [
                "eu-west-1",
                "eu-west-2",
                "eu-west-3",
                "eu-north-1",
                "eu-central-1",
                "eu-south-1",
                "eu-south-2",
              ].some((r) => region.includes(r))
              // 需要前缀的模型列表
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) =>
                modelID.includes(m),
              )
              if (regionRequiresPrefix && modelRequiresPrefix) {
                modelID = `${regionPrefix}.${modelID}`
              }
              break
            }
            case "ap": {
              // 澳大利亚区域
              const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
              // 东京区域
              const isTokyoRegion = region === "ap-northeast-1"
              if (
                isAustraliaRegion &&
                ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
              ) {
                regionPrefix = "au"
                modelID = `${regionPrefix}.${modelID}`
              } else if (isTokyoRegion) {
                // 东京区域使用 jp. 前缀进行跨区域推理
                const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                  modelID.includes(m),
                )
                if (modelRequiresPrefix) {
                  regionPrefix = "jp"
                  modelID = `${regionPrefix}.${modelID}`
                }
              } else {
                // 其他 APAC 区域使用 apac. 前缀
                const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                  modelID.includes(m),
                )
                if (modelRequiresPrefix) {
                  regionPrefix = "apac"
                  modelID = `${regionPrefix}.${modelID}`
                }
              }
              break
            }
          }

          return sdk.languageModel(modelID)
        },
      }
    },

    /**
     * OpenRouter 自定义加载器
     *
     * 添加 HTTP Referer 和 X-Title 头。
     */
    openrouter: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }
    },

    /**
     * Vercel 自定义加载器
     *
     * 添加 HTTP Referer 和 X-Title 头（小写）。
     */
    vercel: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "http-referer": "https://opencode.ai/",
            "x-title": "opencode",
          },
        },
      }
    },

    /**
     * Google Vertex AI 自定义加载器
     *
     * 需要 Google Cloud 项目 ID 和位置。
     */
    "google-vertex": async () => {
      // 获取 Google Cloud 项目 ID（从多个可能的环境变量）
      const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
      // 获取 Vertex AI 位置
      const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-east5"
      // 只有设置了项目才自动加载
      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID: string) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    },

    /**
     * Google Vertex AI 上的 Anthropic Claude
     */
    "google-vertex-anthropic": async () => {
      const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
      const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    },

    /**
     * SAP AI Core 自定义加载器
     *
     * 需要服务密钥和部署 ID。
     */
    "sap-ai-core": async () => {
      const auth = await Auth.get("sap-ai-core")
      // 获取服务密钥
      const envServiceKey = iife(() => {
        const envAICoreServiceKey = Env.get("AICORE_SERVICE_KEY")
        if (envAICoreServiceKey) return envAICoreServiceKey
        if (auth?.type === "api") {
          Env.set("AICORE_SERVICE_KEY", auth.key)
          return auth.key
        }
        return undefined
      })
      const deploymentId = Env.get("AICORE_DEPLOYMENT_ID")
      const resourceGroup = Env.get("AICORE_RESOURCE_GROUP")

      return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup } : {},
        async getModel(sdk: any, modelID: string) {
          return sdk(modelID)
        },
      }
    },

    /**
     * Zenmux 自定义加载器
     */
    zenmux: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }
    },

    /**
     * Cloudflare AI Gateway 自定义加载器
     *
     * 使用 Cloudflare AI Gateway 统一计费。
     */
    "cloudflare-ai-gateway": async (input) => {
      const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
      const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

      // 需要账户 ID 和网关 ID
      if (!accountId || !gateway) return { autoload: false }

      // 获取 API Token（从环境变量或认证存储）
      const apiToken = await (async () => {
        const envToken = Env.get("CLOUDFLARE_API_TOKEN")
        if (envToken) return envToken
        const auth = await Auth.get(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
      })()

      return {
        autoload: true,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          return sdk.languageModel(modelID)
        },
        options: {
          // Cloudflare AI Gateway 兼容端点
          baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}/compat`,
          headers: {
            // Cloudflare AI Gateway 使用 cf-aig-authorization 进行认证
            // 这启用统一计费，Cloudflare 处理上游提供商认证
            ...(apiToken ? { "cf-aig-authorization": `Bearer ${apiToken}` } : {}),
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
          // 自定义 fetch 处理参数转换和认证
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers)
            // 删除 Authorization 头，AI Gateway 使用 cf-aig-authorization
            headers.delete("Authorization")

            // 将 max_tokens 转换为 max_completion_tokens（用于新模型）
            if (init?.body && init.method === "POST") {
              try {
                const body = JSON.parse(init.body as string)
                if (body.max_tokens !== undefined && !body.max_completion_tokens) {
                  body.max_completion_tokens = body.max_tokens
                  delete body.max_tokens
                  init = { ...init, body: JSON.stringify(body) }
                }
              } catch (e) {
                // 如果 body 解析失败，继续使用原始请求
              }
            }

            return fetch(input, { ...init, headers })
          },
        },
      }
    },

    /**
     * Cerebras 自定义加载器
     */
    cerebras: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "X-Cerebras-3rd-Party-Integration": "opencode",
          },
        },
      }
    },
  }

  /**
   * 模型 Schema
   *
   * 定义单个 AI 模型的完整信息。
   */
  export const Model = z
    .object({
      // 模型唯一标识符
      id: z.string(),
      // 所属提供商 ID
      providerID: z.string(),
      // API 信息
      api: z.object({
        // API 中的模型 ID
        id: z.string(),
        // API 端点 URL
        url: z.string(),
        // npm 包名
        npm: z.string(),
      }),
      // 模型显示名称
      name: z.string(),
      // 模型系列（可选）
      family: z.string().optional(),
      // 能力信息
      capabilities: z.object({
        // 是否支持温度参数
        temperature: z.boolean(),
        // 是否支持推理模式
        reasoning: z.boolean(),
        // 是否支持文件附件
        attachment: z.boolean(),
        // 是否支持工具调用
        toolcall: z.boolean(),
        // 输入模态
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        // 输出模态
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        // 是否支持交错的推理内容
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      // 成本信息
      cost: z.object({
        // 输入成本（每 1M tokens）
        input: z.number(),
        // 输出成本（每 1M tokens）
        output: z.number(),
        // 缓存成本
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        // 200K+ 上下文的实验性成本
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      // 限制信息
      limit: z.object({
        // 上下文窗口大小
        context: z.number(),
        // 最大输出 tokens
        output: z.number(),
      }),
      // 模型状态
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      // 额外选项
      options: z.record(z.string(), z.any()),
      // 自定义请求头
      headers: z.record(z.string(), z.string()),
      // 发布日期
      release_date: z.string(),
      // 模型变体
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  /**
   * 提供商信息 Schema
   *
   * 定义 AI 提供商的完整信息。
   */
  export const Info = z
    .object({
      // 提供商唯一标识符
      id: z.string(),
      // 提供商显示名称
      name: z.string(),
      // 来源：env（环境变量）、config（配置）、custom（自定义）、api（认证）
      source: z.enum(["env", "config", "custom", "api"]),
      // 环境变量名列表
      env: z.string().array(),
      // API Key（如果有）
      key: z.string().optional(),
      // 提供商选项
      options: z.record(z.string(), z.any()),
      // 模型列表
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  /**
   * 从 ModelsDev 数据创建模型对象
   *
   * 将 models.dev API 返回的模型数据转换为内部格式。
   */
  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    // 构造基础模型对象
    const m: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        // 200K+ 上下文的实验性成本
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date,
      variants: {},
    }

    // 应用提供商转换生成变体
    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  /**
   * 从 ModelsDev 数据创建提供商对象
   *
   * 将 models.dev API 返回的提供商数据转换为内部格式。
   */
  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: provider.id,
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      // 转换所有模型
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  /**
   * 实例级状态
   *
   * 缓存提供商、模型和 SDK 实例。
   */
  const state = Instance.state(async () => {
    // 使用计时器记录初始化时间
    using _ = log.time("state")
    // 获取配置
    const config = await Config.get()
    // 获取 models.dev 数据
    const modelsDev = await ModelsDev.get()
    // 转换为内部格式
    const database = mapValues(modelsDev, fromModelsDevProvider)

    // 禁用的提供商集合
    const disabled = new Set(config.disabled_providers ?? [])
    // 启用的提供商集合（如果指定）
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

    /**
     * 检查提供商是否被允许
     */
    function isProviderAllowed(providerID: string): boolean {
      // 如果有白名单且提供商不在其中，不允许
      if (enabled && !enabled.has(providerID)) return false
      // 如果提供商在黑名单中，不允许
      if (disabled.has(providerID)) return false
      return true
    }

    // 提供商集合
    const providers: { [providerID: string]: Info } = {}
    // 语言模型缓存
    const languages = new Map<string, LanguageModelV2>()
    // 自定义模型加载器
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    // SDK 实例缓存
    const sdk = new Map<number, SDK>()

    log.info("init")

    // 获取配置中的提供商
    const configProviders = Object.entries(config.provider ?? {})

    // 添加 GitHub Copilot Enterprise 提供商（继承自 GitHub Copilot）
    if (database["github-copilot"]) {
      const githubCopilot = database["github-copilot"]
      database["github-copilot-enterprise"] = {
        ...githubCopilot,
        id: "github-copilot-enterprise",
        name: "GitHub Copilot Enterprise",
        models: mapValues(githubCopilot.models, (model) => ({
          ...model,
          providerID: "github-copilot-enterprise",
        })),
      }
    }

    /**
     * 合并提供商信息
     */
    function mergeProvider(providerID: string, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {
        // 深度合并到现有提供商
        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, provider)
        return
      }
      const match = database[providerID]
      if (!match) return
      // 深度合并到数据库中的提供商
      // @ts-expect-error
      providers[providerID] = mergeDeep(match, provider)
    }

    // 从配置扩展数据库
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      // 解析配置中的提供商
      const parsed: Info = {
        id: providerID,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: existing?.models ?? {},
      }

      // 解析配置中的模型
      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const existingModel = parsed.models[model.id ?? modelID]
        // 确定模型名称
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        // 解析模型配置
        const parsedModel: Model = {
          id: modelID,
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm:
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible",
            url: provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID,
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
          family: model.family ?? existingModel?.family ?? "",
          release_date: model.release_date ?? existingModel?.release_date ?? "",
          variants: {},
        }
        // 合并变体
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    // 加载环境变量中的 API Key
    const env = Env.all()
    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID)) continue
      // 查找第一个非空的 API Key
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (!apiKey) continue
      mergeProvider(providerID, {
        source: "env",
        key: provider.env.length === 1 ? apiKey : undefined,
      })
    }

    // 加载认证存储中的 API Key
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (disabled.has(providerID)) continue
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
    }

    // 处理插件提供的认证
    for (const plugin of await Plugin.list()) {
      if (!plugin.auth) continue
      const providerID = plugin.auth.provider
      if (disabled.has(providerID)) continue

      // 对于 github-copilot 插件，检查 github-copilot 或 github-copilot-enterprise 的认证
      let hasAuth = false
      const auth = await Auth.get(providerID)
      if (auth) hasAuth = true

      // 特殊处理：github-copilot 也检查企业版认证
      if (providerID === "github-copilot" && !hasAuth) {
        const enterpriseAuth = await Auth.get("github-copilot-enterprise")
        if (enterpriseAuth) hasAuth = true
      }

      if (!hasAuth) continue
      if (!plugin.auth.loader) continue

      // 为主提供商加载
      if (auth) {
        const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
        mergeProvider(plugin.auth.provider, {
          source: "custom",
          options: options,
        })
      }

      // 如果是 github-copilot 插件，也为 github-copilot-enterprise 注册
      if (providerID === "github-copilot") {
        const enterpriseProviderID = "github-copilot-enterprise"
        if (!disabled.has(enterpriseProviderID)) {
          const enterpriseAuth = await Auth.get(enterpriseProviderID)
          if (enterpriseAuth) {
            const enterpriseOptions = await plugin.auth.loader(
              () => Auth.get(enterpriseProviderID) as any,
              database[enterpriseProviderID],
            )
            mergeProvider(enterpriseProviderID, {
              source: "custom",
              options: enterpriseOptions,
            })
          }
        }
      }
    }

    // 应用自定义加载器
    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (disabled.has(providerID)) continue
      const result = await fn(database[providerID])
      if (result && (result.autoload || providers[providerID])) {
        if (result.getModel) modelLoaders[providerID] = result.getModel
        mergeProvider(providerID, {
          source: "custom",
          options: result.options,
        })
      }
    }

    // 加载配置中的提供商选项
    for (const [providerID, provider] of configProviders) {
      const partial: Partial<Info> = { source: "config" }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    // 过滤和最终处理提供商
    for (const [providerID, provider] of Object.entries(providers)) {
      // 检查提供商是否被允许
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      // GitHub Copilot 特殊处理
      if (providerID === "github-copilot" || providerID === "github-copilot-enterprise") {
        provider.models = mapValues(provider.models, (model) => ({
          ...model,
          api: {
            ...model.api,
            npm: "@ai-sdk/github-copilot",
          },
        }))
      }

      const configProvider = config.provider?.[providerID]

      // 过滤模型
      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api.id = model.api.id ?? model.id ?? modelID
        // 移除特定模型
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat"))
          delete provider.models[modelID]
        // 移除实验性模型（如果未启用）
        if (model.status === "alpha" && !Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        // 移除已弃用模型
        if (model.status === "deprecated") delete provider.models[modelID]
        // 根据黑名单/白名单过滤
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]

        // 合并配置中的变体设置
        const configVariants = configProvider?.models?.[modelID]?.variants
        if (configVariants && model.variants) {
          const merged = mergeDeep(model.variants, configVariants)
          model.variants = mapValues(
            pickBy(merged, (v) => !v.disabled),
            (v) => omit(v, ["disabled"]),
          )
        }
      }

      // 如果没有模型，移除提供商
      if (Object.keys(provider.models).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    return {
      models: languages,
      providers,
      sdk,
      modelLoaders,
    }
  })

  /**
   * 获取所有提供商
   *
   * @returns Promise，解析为提供商 ID 到提供商信息的映射
   */
  export async function list() {
    return state().then((state) => state.providers)
  }

  /**
   * 获取 SDK 实例
   *
   * 为指定模型创建或获取 SDK 实例。
   */
  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }

      // OpenAI 兼容提供商默认包含使用信息
      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      // 设置 baseURL
      if (!options["baseURL"]) options["baseURL"] = model.api.url
      // 设置 API Key
      if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
      // 合并请求头
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      // 根据配置生成缓存键
      const key = Bun.hash.xxHash32(JSON.stringify({ npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      // 保留自定义 fetch 函数
      const customFetch = options["fetch"]

      // 包装 fetch 函数添加超时逻辑
      options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
        const fetchFn = customFetch ?? fetch
        const opts = init ?? {}

        // 处理超时
        if (options["timeout"] !== undefined && options["timeout"] !== null) {
          const signals: AbortSignal[] = []
          if (opts.signal) signals.push(opts.signal)
          if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

          const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
          opts.signal = combined
        }

        return fetchFn(input, {
          ...opts,
          // @ts-ignore 见：https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })
      }

      // 特殊情况：google-vertex-anthropic 使用子路径导入
      const bundledKey =
        model.providerID === "google-vertex-anthropic" ? "@ai-sdk/google-vertex/anthropic" : model.api.npm
      const bundledFn = BUNDLED_PROVIDERS[bundledKey]
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: bundledKey })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as SDK
      }

      // 动态安装和加载提供商
      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await BunProc.install(model.api.npm, "latest")
      } else {
        log.info("loading local provider", { pkg: model.api.npm })
        installedPath = model.api.npm
      }

      const mod = await import(installedPath)

      // 查找 create* 函数
      const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
      const loaded = fn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  /**
   * 获取指定提供商
   *
   * @param providerID - 提供商 ID
   * @returns Promise，解析为提供商信息
   */
  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID])
  }

  /**
   * 获取指定模型
   *
   * @param providerID - 提供商 ID
   * @param modelID - 模型 ID
   * @returns Promise，解析为模型信息
   * @throws ModelNotFoundError 如果提供商或模型不存在
   */
  export async function getModel(providerID: string, modelID: string) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const matches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    const info = provider.models[modelID]
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  /**
   * 获取 SDK 语言模型实例
   *
   * 为指定模型创建可用的语言模型实例。
   *
   * @param model - 模型信息
   * @returns Promise，解析为 LanguageModelV2 实例
   */
  export async function getLanguage(model: Model): Promise<LanguageModelV2> {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    // 检查缓存
    if (s.models.has(key)) return s.models.get(key)!

    const provider = s.providers[model.providerID]
    const sdk = await getSDK(model)

    try {
      // 使用自定义加载器或默认方法
      const language = s.modelLoaders[model.providerID]
        ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
        : sdk.languageModel(model.api.id)
      s.models.set(key, language)
      return language
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  /**
   * 模糊匹配模型
   *
   * 根据查询字符串查找匹配的模型。
   *
   * @param providerID - 提供商 ID
   * @param query - 查询字符串列表
   * @returns 匹配的模型信息，如果未找到返回 undefined
   */
  export async function closest(providerID: string, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  /**
   * 获取小型模型
   *
   * 用于快速操作（如工具调用、摘要等）的小型模型。
   *
   * @param providerID - 提供商 ID
   * @returns Promise，解析为模型信息，如果未找到返回 undefined
   */
  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()

    // 优先使用配置的小型模型
    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    // 获取提供商
    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
      // 小型模型优先级列表
      let priority = [
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "3-5-haiku",
        "3.5-haiku",
        "gemini-3-flash",
        "gemini-2.5-flash",
        "gpt-5-nano",
      ]
      if (providerID.startsWith("opencode")) {
        priority = ["gpt-5-nano"]
      }
      if (providerID.startsWith("github-copilot")) {
        // GitHub Copilot 优先使用免费模型
        priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
      }
      for (const item of priority) {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return getModel(providerID, model)
        }
      }
    }

    // 回退到 opencode 提供商
    const opencodeProvider = await state().then((state) => state.providers["opencode"])
    if (opencodeProvider && opencodeProvider.models["gpt-5-nano"]) {
      return getModel("opencode", "gpt-5-nano")
    }

    return undefined
  }

  // 模型优先级（用于排序）
  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

  /**
   * 对模型进行排序
   *
   * 根据优先级对模型列表排序。
   *
   * @param models - 模型列表
   * @returns 排序后的模型列表
   */
  export function sort(models: Model[]) {
    return sortBy(
      models,
      // 优先级高的在前
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      // latest 标签的在前
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      // ID 降序（新版本在前）
      [(model) => model.id, "desc"],
    )
  }

  /**
   * 获取默认模型
   *
   * @returns Promise，解析为提供商 ID 和模型 ID
   * @throws Error 如果没有找到提供商或模型
   */
  export async function defaultModel() {
    const cfg = await Config.get()
    // 优先使用配置的默认模型
    if (cfg.model) return parseModel(cfg.model)

    // 查找第一个可用的提供商
    const provider = await list()
      .then((val) => Object.values(val))
      .then((x) => x.find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id)))
    if (!provider) throw new Error("no providers found")
    // 获取排序后的第一个模型
    const [model] = sort(Object.values(provider.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: provider.id,
      modelID: model.id,
    }
  }

  /**
   * 解析模型字符串
   *
   * 将 "providerID/modelID" 格式的字符串解析为对象。
   *
   * @param model - 模型字符串
   * @returns 包含 providerID 和 modelID 的对象
   */
  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: providerID,
      modelID: rest.join("/"),
    }
  }

  /**
   * 模型未找到错误
   *
   * 当提供商或模型不存在时抛出。
   */
  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  /**
   * 提供商初始化错误
   *
   * 当提供商 SDK 初始化失败时抛出。
   */
  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )
}

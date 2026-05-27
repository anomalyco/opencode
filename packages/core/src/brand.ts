/** 云熙智能体（yunpat）— 本仓库统一品牌与部署路径 */

const providerAllowlist = [
  "deepseek",
  "alibaba-cn",
  "moonshotai-cn",
  "zhipuai",
  "siliconflow-cn",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "minimax-cn",
  "siliconflow",
  "github-copilot",
  "302ai",
  "qiniu-ai",
] as const

/** 主会话默认：DeepSeek V4 Pro（复杂推理、工具调用） */
const defaultModel = "deepseek/deepseek-v4-pro"
/** 轻量任务默认：DeepSeek V4 Flash（标题生成等） */
const defaultSmallModel = "deepseek/deepseek-v4-flash"

/** 合并进用户配置的 DeepSeek 默认项（用户显式配置优先） */
const defaultProviderConfig = {
  deepseek: {
    options: {
      baseURL: "https://api.deepseek.com",
    },
  },
} as const

export const AgentBrand = {
  nameEn: "yunpat",
  nameZh: "云熙智能体",
  projectDir: ".yunpat-agent",
  xdgAppName: "yunpat-agent",
  configBasename: "yunpat-agent",
  urlScheme: "yunpat://",
  macBundleId: "com.yunpat.agent",
  /** models.dev 提供商 ID：热门分组与默认 enabled_providers */
  popularProviders: providerAllowlist,
  defaultEnabledProviders: providerAllowlist,
  defaultModel,
  defaultSmallModel,
  defaultProviderConfig,
} as const

export * as Brand from "./brand"

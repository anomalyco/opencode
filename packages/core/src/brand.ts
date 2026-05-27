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
} as const

export * as Brand from "./brand"

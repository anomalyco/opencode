/** 云熙智能体（yunpat）— 本仓库统一品牌与部署路径 */
export const AgentBrand = {
  nameEn: "yunpat",
  nameZh: "云熙智能体",
  projectDir: ".yunpat-agent",
  xdgAppName: "yunpat-agent",
  configBasename: "yunpat-agent",
  urlScheme: "yunpat://",
  macBundleId: "com.yunpat.agent",
} as const

export * as Brand from "./brand"

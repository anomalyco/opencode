// 校园品牌注册表（MUC / HUBU 共用单 Core 的唯一品牌数据源）。
//
// 设计约定（HUBU_LOCAL_IMPLEMENTATION_PLAN §1）：
// - 本文件是品牌数据的唯一事实源；brands/<id>/brand.json 是构建脚本
//   （electron-builder 等 node 侧）使用的镜像，两侧由 registry.test.ts 保证一致。
// - 新增一所学校 = 新增一个 BrandConfig + 一个 brand.json + 图标/主视觉，
//   不 fork 任何 Core。
// - muc 分支的历史行为逐字节保留：muc 的取值与旧硬编码完全一致。

export interface BrandColors {
  /** 主色（深绿 / 民大红） */
  primary: string
  /** 主色加深（hover / 按下） */
  primaryDark: string
  /** 青铜金（楚文化饰线 / 校训） */
  gold: string
  /** 亮金（点缀） */
  goldBright: string
  /** 深色背景（墨绿黑） */
  background: string
  /** 深色面板 */
  surface: string
  /** 深底上的正文 */
  onDark: string
  /** 深底上的次要文字 */
  mutedOnDark: string
  /** 门页副标题柔光色 */
  onDarkSoft: string
}

export interface BrandConfig {
  /** 稳定标识："muc" / "hubu"；基础品牌 "opencode"（campus=false） */
  id: string
  /** 是否校园品牌（决定是否显示品牌门/启动页） */
  campus: boolean
  name: string
  englishName: string
  shortName: string
  productName: string
  /** 校训（规范写法，含逗号） */
  motto: string
  /** 展示用校训（分隔符版） */
  mottoDisplay: string
  founded: string
  /** macOS/Windows 应用 ID（反向域名） */
  appId: string
  /** 运行时 app 名称（app.setName / 标题） */
  appName: string
  /** 深链协议（muc:// / hubu://） */
  protocolScheme: string
  /** 默认网关地址（可用 <gatewayEnvVar> 环境变量覆盖） */
  gatewayURL: string
  gatewayEnvVar: string
  /** 核心 provider 注入读取的 API Key 环境变量 */
  apiKeyEnvVar: string
  /** 一次性授权码交换端点路径 */
  exchangePath: string
  /** 网站品牌页路径（/muc、/hubu） */
  sitePath: string
  /** TUI 主题名（theme/index.ts 注册名） */
  tuiTheme: string
  colors: BrandColors
  /** 安装包文件名（与 /downloads 静态目录对应） */
  downloads: { macArm: string; macIntel: string; win: string }
  /** 桌面启动门/启动页文案 */
  splash: { title: string; subtitle: string; footer: string; showFounded: boolean }
}

const MUC: BrandConfig = {
  id: "muc",
  campus: true,
  name: "中央民族大学",
  englishName: "Minzu University of China",
  shortName: "MUC",
  productName: "MUC AI Harness",
  motto: "美美与共，知行合一",
  mottoDisplay: "美美与共 · 知行合一",
  founded: "1941",
  appId: "cn.edu.muc.harness",
  appName: "mucode",
  protocolScheme: "muc",
  gatewayURL: "http://admin.wuxuexi.top",
  gatewayEnvVar: "MUC_GATEWAY_URL",
  apiKeyEnvVar: "MUC_API_KEY",
  exchangePath: "/api/v1/muc/exchange",
  sitePath: "/muc",
  tuiTheme: "minzu",
  colors: {
    primary: "#AC0E0F",
    primaryDark: "#8f0c0d",
    gold: "#D9A94E",
    goldBright: "#E8C97C",
    background: "#0d0a0b",
    surface: "#171113",
    onDark: "#F5EDE4",
    mutedOnDark: "#BCA992",
    onDarkSoft: "#c9bfb2",
  },
  downloads: {
    macArm: "mucode-mac-arm64.dmg",
    macIntel: "mucode-mac-x64.dmg",
    win: "mucode-win-x64.exe",
  },
  splash: {
    title: "MUC AI Harness",
    subtitle: "中央民族大学",
    footer: "",
    showFounded: false,
  },
}

const HUBU: BrandConfig = {
  id: "hubu",
  campus: true,
  name: "湖北大学",
  englishName: "Hubei University",
  shortName: "HUBU",
  productName: "HUBU AI",
  motto: "日思日睿，笃志笃行",
  mottoDisplay: "日思日睿 · 笃志笃行",
  founded: "1931",
  appId: "cn.edu.hubu.harness",
  appName: "HUBU AI",
  protocolScheme: "hubu",
  // 本地开发默认 localhost:8081；部署时可用 HUBU_GATEWAY_URL 覆盖
  gatewayURL: "http://localhost:8081",
  gatewayEnvVar: "HUBU_GATEWAY_URL",
  apiKeyEnvVar: "HUBU_API_KEY",
  exchangePath: "/api/v1/hubu/exchange",
  sitePath: "/hubu",
  tuiTheme: "hubu",
  colors: {
    // 深湖大绿/青铜金采样自湖北大学主视觉图 hubu-hero.png（横幅深绿 #17503A/#104B37、饰带金 #BC9D53），
    // 为采样值而非湖北大学官方 VI 标准色。
    primary: "#135440",
    primaryDark: "#0F4433",
    gold: "#BC9D53",
    goldBright: "#E0C57C",
    background: "#0B1F17",
    surface: "#142B21",
    onDark: "#F2F0E6",
    mutedOnDark: "#9DB5A8",
    onDarkSoft: "#A8C0B4",
  },
  downloads: {
    macArm: "hubu-ai-mac-arm64.dmg",
    macIntel: "hubu-ai-mac-x64.dmg",
    win: "hubu-ai-win-x64.exe",
  },
  splash: {
    title: "HUBU AI",
    subtitle: "湖北大学 HUBEI UNIVERSITY",
    footer: "Powered by HUBU AI Harness",
    showFounded: true,
  },
}

/** 基础品牌：dev/beta/prod 通道回退到 OpenCode 上游品牌（无校园门/主题） */
const OPENCODE: BrandConfig = {
  id: "opencode",
  campus: false,
  name: "OpenCode",
  englishName: "OpenCode",
  shortName: "OpenCode",
  productName: "OpenCode",
  motto: "",
  mottoDisplay: "",
  founded: "",
  appId: "ai.opencode.desktop",
  appName: "OpenCode",
  protocolScheme: "opencode",
  gatewayURL: "",
  gatewayEnvVar: "OPENCODE_GATEWAY_URL",
  apiKeyEnvVar: "OPENCODE_API_KEY",
  exchangePath: "",
  sitePath: "",
  tuiTheme: "opencode",
  colors: {
    primary: "#8B5CF6",
    primaryDark: "#7C3AED",
    gold: "#D9A94E",
    goldBright: "#E8C97C",
    background: "#0B0B0C",
    surface: "#17181A",
    onDark: "#F5F5F4",
    mutedOnDark: "#A8A29E",
    onDarkSoft: "#D6D3D1",
  },
  downloads: { macArm: "", macIntel: "", win: "" },
  splash: { title: "OpenCode", subtitle: "", footer: "", showFounded: false },
}

export const BRANDS: Record<string, BrandConfig> = {
  muc: MUC,
  hubu: HUBU,
  opencode: OPENCODE,
}

/** 从环境解析品牌：BRAND > OPENCODE_CHANNEL > muc（保持历史默认） */
export function resolveBrandId(env?: { BRAND?: string; OPENCODE_CHANNEL?: string }): string {
  const e = env ?? globalEnv()
  const raw = (e.BRAND || e.OPENCODE_CHANNEL || "").trim().toLowerCase()
  if (raw === "hubu") return "hubu"
  if (raw === "prod" || raw === "beta" || raw === "dev") return "opencode"
  // 未识别/未设置：默认 muc（与历史行为一致）
  return "muc"
}

export function resolveBrand(env?: { BRAND?: string; OPENCODE_CHANNEL?: string }): BrandConfig {
  return BRANDS[resolveBrandId(env)] ?? MUC
}

/** 当前进程/构建的品牌。渲染层（vite）与主进程（electron-vite）都会注入 import.meta.env。 */
export function currentBrand(): BrandConfig {
  return resolveBrand(globalEnv())
}

function globalEnv(): { BRAND?: string; OPENCODE_CHANNEL?: string } {
  const out: { BRAND?: string; OPENCODE_CHANNEL?: string } = {}
  const meta = (import.meta as unknown as { env?: Record<string, string> })?.env
  if (meta) {
    out.BRAND = meta.BRAND ?? meta.VITE_BRAND
    out.OPENCODE_CHANNEL = meta.OPENCODE_CHANNEL ?? meta.VITE_OPENCODE_CHANNEL
  }
  const proc = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
  if (proc) {
    out.BRAND = out.BRAND || proc.BRAND
    out.OPENCODE_CHANNEL = out.OPENCODE_CHANNEL || proc.OPENCODE_CHANNEL
  }
  return out
}

export const channels = { MUC, HUBU, OPENCODE }

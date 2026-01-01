/**
 * Platform detection and configuration for AI chat platforms
 */

export type Platform =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "poe"
  | "you"
  | "huggingface"
  | "copilot"
  | "deepseek"
  | "openrouter"
  | "opencode"

export interface PlatformConfig {
  name: string
  hostnames: string[]
  conversationUrlPattern: RegExp | null
  exportEnabled: boolean
}

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  opencode: {
    name: "OpenCode",
    hostnames: ["localhost:4096"],
    conversationUrlPattern: null,
    exportEnabled: false,
  },
  claude: {
    name: "Claude",
    hostnames: ["claude.ai"],
    conversationUrlPattern: /\/chat\/([^/?]+)/,
    exportEnabled: true,
  },
  chatgpt: {
    name: "ChatGPT",
    hostnames: ["chat.openai.com", "chatgpt.com"],
    conversationUrlPattern: /\/c\/([^/?]+)/,
    exportEnabled: true,
  },
  gemini: {
    name: "Gemini",
    hostnames: ["gemini.google.com"],
    conversationUrlPattern: /\/app\/([^/?]+)/,
    exportEnabled: true,
  },
  perplexity: {
    name: "Perplexity",
    hostnames: ["perplexity.ai"],
    conversationUrlPattern: /\/search\/([^/?]+)/,
    exportEnabled: true,
  },
  poe: {
    name: "Poe",
    hostnames: ["poe.com"],
    conversationUrlPattern: /\/chat\/([^/?]+)/,
    exportEnabled: true,
  },
  you: {
    name: "You.com",
    hostnames: ["you.com"],
    conversationUrlPattern: null,
    exportEnabled: false,
  },
  huggingface: {
    name: "HuggingFace",
    hostnames: ["huggingface.co"],
    conversationUrlPattern: null,
    exportEnabled: false,
  },
  copilot: {
    name: "Copilot",
    hostnames: ["copilot.microsoft.com"],
    conversationUrlPattern: null,
    exportEnabled: false,
  },
  deepseek: {
    name: "DeepSeek",
    hostnames: ["chat.deepseek.com"],
    conversationUrlPattern: /\/chat\/([^/?]+)/,
    exportEnabled: true,
  },
  openrouter: {
    name: "OpenRouter",
    hostnames: ["openrouter.ai"],
    conversationUrlPattern: null,
    exportEnabled: false,
  },
}

/**
 * Detect platform from a URL or hostname
 */
export function detectPlatform(url?: string): Platform | null {
  const hostname = url ? new URL(url).hostname : typeof window !== "undefined" ? window.location.hostname : null

  if (!hostname) return null

  for (const [platform, config] of Object.entries(PLATFORMS)) {
    if (config.hostnames.some((host) => hostname.includes(host))) {
      return platform as Platform
    }
  }

  return null
}

/**
 * Get conversation ID from URL based on platform
 */
export function getConversationId(platform: Platform, url?: string): string | null {
  const pathname = url ? new URL(url).pathname : typeof window !== "undefined" ? window.location.pathname : null

  if (!pathname) return null

  const config = PLATFORMS[platform]
  if (!config.conversationUrlPattern) return null

  const match = pathname.match(config.conversationUrlPattern)
  return match ? match[1] : null
}

/**
 * Check if current page is a conversation page
 */
export function isConversationPage(platform: Platform, url?: string): boolean {
  return !!getConversationId(platform, url)
}

/**
 * Check if export is supported for platform
 */
export function isExportSupported(platform: Platform): boolean {
  return PLATFORMS[platform]?.exportEnabled ?? false
}

/**
 * Get platform config by name
 */
export function getPlatformConfig(platform: Platform): PlatformConfig | null {
  return PLATFORMS[platform] || null
}

/**
 * Get all platforms that support export
 */
export function getExportablePlatforms(): Platform[] {
  return Object.entries(PLATFORMS)
    .filter(([_, config]) => config.exportEnabled)
    .map(([platform]) => platform as Platform)
}

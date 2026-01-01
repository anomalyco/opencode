export interface Platform {
  id: string
  name: string
  url: string
  icon: string
  isBuiltIn: boolean
  isVisible: boolean
  order: number
}

export const DEFAULT_PLATFORMS: Platform[] = [
  {
    id: "opencode",
    name: "OpenCode",
    url: "http://localhost:4096/",
    icon: "home",
    isBuiltIn: true,
    isVisible: true,
    order: 0,
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com",
    icon: "chatgpt",
    isBuiltIn: true,
    isVisible: true,
    order: 1,
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai",
    icon: "claude",
    isBuiltIn: true,
    isVisible: true,
    order: 2,
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    icon: "gemini",
    isBuiltIn: true,
    isVisible: true,
    order: 3,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    url: "https://claude.ai/code",
    icon: "claudecode",
    isBuiltIn: true,
    isVisible: true,
    order: 4,
  },
]

export const PRESET_PLATFORMS: Omit<Platform, "order" | "isVisible">[] = [
  {
    id: "perplexity",
    name: "Perplexity",
    url: "https://www.perplexity.ai",
    icon: "perplexity",
    isBuiltIn: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com",
    icon: "deepseek",
    isBuiltIn: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    url: "https://openrouter.ai/playground",
    icon: "openrouter",
    isBuiltIn: false,
  },
  {
    id: "poe",
    name: "Poe",
    url: "https://poe.com",
    icon: "poe",
    isBuiltIn: false,
  },
  {
    id: "you",
    name: "You.com",
    url: "https://you.com/search?tbm=youchat",
    icon: "you",
    isBuiltIn: false,
  },
  {
    id: "huggingchat",
    name: "HuggingChat",
    url: "https://huggingface.co/chat",
    icon: "huggingface",
    isBuiltIn: false,
  },
  {
    id: "copilot",
    name: "Copilot",
    url: "https://copilot.microsoft.com",
    icon: "copilot",
    isBuiltIn: false,
  },
  {
    id: "grok",
    name: "Grok",
    url: "https://grok.x.ai",
    icon: "grok",
    isBuiltIn: false,
  },
]

export const PLATFORM_ICONS: Record<string, string> = {
  home: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`,
  claude: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="12" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">C</text></svg>`,
  claudecode: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="6" width="18" height="12" rx="2"/><text x="12" y="15" font-size="8" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">CC</text></svg>`,
  chatgpt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.82a5.98 5.98 0 00-.52-4.91 6.05 6.05 0 00-6.51-2.9A6.07 6.07 0 004.98 4.18a5.98 5.98 0 00-4 2.9 6.05 6.05 0 00.74 7.1 5.98 5.98 0 00.51 4.91 6.05 6.05 0 006.51 2.9A5.98 5.98 0 0013.26 24a6.06 6.06 0 005.77-4.21 5.99 5.99 0 004-2.9 6.06 6.06 0 00-.75-7.07z"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="12" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">G</text></svg>`,
  perplexity: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  deepseek: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="15" font-size="7" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">DS</text></svg>`,
  openrouter: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="15" font-size="7" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">OR</text></svg>`,
  poe: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="10" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">P</text></svg>`,
  you: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
  huggingface: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1.5" fill="var(--bg-primary)"/><circle cx="16" cy="10" r="1.5" fill="var(--bg-primary)"/><path d="M8 14c0 2 1.8 3.5 4 3.5s4-1.5 4-3.5" stroke="var(--bg-primary)" stroke-width="1.5" fill="none"/></svg>`,
  copilot: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="10" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">C</text></svg>`,
  grok: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="10" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">X</text></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
  chevronUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  apps: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
  plug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6"/><path d="M12 16v6"/><path d="M16 12a4 4 0 00-4-4v0a4 4 0 00-4 4v2h8v-2z"/><path d="M9 20h6"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
}

export type OpenCodeStatus = "checking" | "connected" | "disconnected"

export function getIcon(iconName: string, fallbackLetter?: string): string {
  if (PLATFORM_ICONS[iconName]) {
    return PLATFORM_ICONS[iconName]
  }
  const letter = (fallbackLetter || iconName || "?").charAt(0).toUpperCase()
  return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="12" font-weight="bold" text-anchor="middle" fill="var(--bg-primary)" font-family="system-ui">${letter}</text></svg>`
}

export function loadPlatforms(): Platform[] {
  try {
    const saved = localStorage.getItem("eidorail-platforms")
    if (saved) {
      const parsed = JSON.parse(saved)
      const savedIds = new Set(parsed.map((p: Platform) => p.id))
      const defaults = DEFAULT_PLATFORMS.filter((p) => !savedIds.has(p.id))
      return [...parsed, ...defaults]
    }
  } catch (e) {
    console.warn("[Eidorail] Failed to load platforms:", e)
  }
  return [...DEFAULT_PLATFORMS]
}

export function savePlatformsToStorage(p: Platform[]) {
  localStorage.setItem("eidorail-platforms", JSON.stringify(p))
}

export const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

export const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

export function pickAvailableColor(used: Set<string>): AvatarColorKey {
  const available = AVATAR_COLOR_KEYS.filter((key) => !used.has(key))
  if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
  return available[Math.floor(Math.random() * available.length)]
}

export function pickProjectIcon(input: { child?: string; meta?: { url?: string; override?: string } }) {
  const url = input.child ?? input.meta?.url ?? input.meta?.override
  const override = input.child ?? input.meta?.override ?? input.meta?.url
  return { url, override }
}

export function pickProjectIconSrc(input: {
  id?: string
  icon?: { url?: string; override?: string }
  fallback?: string
}) {
  if (input.id === OPENCODE_PROJECT_ID) return "https://opencode.ai/favicon.svg"
  return input.icon?.url ?? input.icon?.override ?? input.fallback
}

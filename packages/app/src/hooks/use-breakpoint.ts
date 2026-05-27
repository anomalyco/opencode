import { createMediaQuery } from "@solid-primitives/media"

type Breakpoint = "sm" | "md" | "lg" | "xl" | "2xl"

export function useMinBreakpoint(breakpoint: Breakpoint) {
  return createMediaQuery(`(min-width: ${cssBreakpoint(breakpoint)})`)
}

/**
 * Prefer reading breakpoints from css env vars defined in packages/ui/src/styles/theme.css
 * to avoid future "breakpoint" drift, use javascript only as a fallback
 */
function cssBreakpoint(breakpoint: Breakpoint) {
  if (typeof window === "undefined") return fallbackBreakpoint(breakpoint)
  return getComputedStyle(document.documentElement).getPropertyValue(`--breakpoint-${breakpoint}`).trim()
}

function fallbackBreakpoint(breakpoint: Breakpoint) {
  return {
    sm: "40rem",
    md: "48rem",
    lg: "64rem",
    xl: "80rem",
    "2xl": "96rem",
  }[breakpoint]
}

import { isFallbackTitle } from "@opencode-ai/util/session-title-fallback"

// Draft, preparing, and untitled session tabs share one localized label.
export function sessionTabTitle(title: string | undefined, fallback: string) {
  return !title || isFallbackTitle(title) ? fallback : title
}

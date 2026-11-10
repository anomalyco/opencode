import { parseLocale, route } from "~/lib/language"
import { copied, copyUrl } from "../copy"
import { $, html } from "../dom"

/**
 * "Copy rules for your agent" (agent-rules-button.tsx, on Brand and Press): copies the Brand page's
 * Markdown version, the same document the hydrated button builds, in the page's language. Its copy
 * icon turns into a check for a moment (Settings › Agent button copied "check only").
 */
export default function agentRules(button: HTMLElement) {
  const url = route(parseLocale(html.dataset.locale) ?? "en", "/brand.md")
  button.addEventListener("click", () => void copied(button, () => copyUrl(url), $("[aria-live]", button)))
}

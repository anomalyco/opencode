export * as McpSubscription from "./subscription.js"

const TEXT_LIMIT = 16_000

// The spec allows `notifications/resources/updated` to name a sub-resource of the URI
// the client put in `resourceSubscriptions`, not only that exact URI.
export function matchesSubscribedUri(subscribed: string, notified: string) {
  const base = subscribed.endsWith("/") ? subscribed.slice(0, -1) : subscribed
  if (base === notified) return true
  if (!notified.startsWith(base)) return false
  const next = notified[base.length]
  return next === "/" || next === "?" || next === "#"
}

export function resourceUpdateText(parts: readonly { readonly type: "text"; readonly text: string }[]) {
  const text = parts.map((part) => part.text).join("\n")
  if (text.length === 0) return undefined
  if (text.length <= TEXT_LIMIT) return text
  return `${text.slice(0, TEXT_LIMIT)}\n[truncated]`
}

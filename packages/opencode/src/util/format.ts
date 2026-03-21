export function formatDuration(secs: number) {
  if (secs <= 0) return ""
  if (secs < 60) return `${secs}s`
  if (secs < 3600) {
    const mins = Math.floor(secs / 60)
    const remaining = secs % 60
    return remaining > 0 ? `${mins}m ${remaining}s` : `${mins}m`
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600)
    const remaining = Math.floor((secs % 3600) / 60)
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
  }
  if (secs < 604800) {
    const days = Math.floor(secs / 86400)
    return days === 1 ? "~1 day" : `~${days} days`
  }
  const weeks = Math.floor(secs / 604800)
  return weeks === 1 ? "~1 week" : `~${weeks} weeks`
}


/**
 * Regex to match <think>...</think> and <thinking>...</thinking> blocks.
 * Uses non-greedy matching to handle multiple blocks.
 */
const THINK_TAG_RE = /<(think(?:ing)?)>[\s\S]*?<\/\1>\s*/g

/**
 * Strip `<think>`/`<thinking>` tag blocks from text for display purposes.
 * The raw tags are preserved in storage for multi-turn LLM context.
 */
export function stripThinkTags(text: string): string {
  return text.replace(THINK_TAG_RE, "").trim()
}

/**
 * Extract `<think>`/`<thinking>` blocks and remaining text separately.
 * Returns the reasoning content and the cleaned display text.
 */
export function splitThinkBlocks(text: string): { reasoning: string; text: string } {
  const blocks: string[] = []
  const cleaned = text.replace(THINK_TAG_RE, (match) => {
    const inner = match.replace(/<\/?(?:think(?:ing)?)>/g, "").trim()
    if (inner) blocks.push(inner)
    return ""
  })
  return {
    reasoning: blocks.join("\n\n"),
    text: cleaned.trim(),
  }
}

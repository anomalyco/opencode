/**
 * Utilities for handling `<think>`/`<thinking>` tags in LLM responses.
 *
 * These tags are kept in storage to preserve multi-turn LLM context,
 * but should be stripped or separated at the rendering layer.
 */

/**
 * Regex to match `<think>...</think>` and `<thinking>...</thinking>` blocks.
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
export function splitThinkBlocks(text: string): {
  reasoning: string
  text: string
} {
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

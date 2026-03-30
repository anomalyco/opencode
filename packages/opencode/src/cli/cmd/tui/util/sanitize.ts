// Patterns for tags injected by system prompts / wrappers that
// the model sometimes echoes back in its response text.
const tag = (name: string) =>
  new RegExp("<" + name + ">[\\s\\S]*?</" + name + ">", "g")

const PATTERNS: RegExp[] = [
  tag("system-reminder"),
  tag("dcp-" + "message-id"),
  tag("dcp-" + "system-reminder"),
  new RegExp("<" + "!--\\s*OMO_INTERNAL[\\s\\S]*?--" + ">", "g"),
]

export function sanitize(text: string): string {
  let result = text
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result.trim()
}

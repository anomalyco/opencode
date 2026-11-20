export * as ConfigMarkdown from "./markdown.js"

import matter from "gray-matter"
export function parse(content: string) {
  // Passing options bypasses gray-matter's module-global content cache, which
  // it populates before parsing: a failed YAML parse poisons the entry and
  // every later parse of the same content replays it without throwing, so the
  // sanitize fallback below never runs. Upstream: jonschlinkert/gray-matter#166.
  try {
    return matter(content, {})
  } catch {
    return matter(sanitize(content), {})
  }
}

export function parseOption(content: string) {
  try {
    return parse(content)
  } catch {
    return undefined
  }
}

// Join a legacy separate `variant` into a string `model` so it survives native decoding.
// Embedded and structured native selections, and a variant without a model, stay unchanged.
export function joinLegacyVariant(data: Record<string, unknown>) {
  if (typeof data.model !== "string" || data.model.includes("#")) return data
  if (typeof data.variant !== "string" || !/^[^#]+$/.test(data.variant)) return data
  return { ...data, model: `${data.model}#${data.variant}` }
}

// Other coding agents accept unquoted colons and leading tags like `[Tag] text`
// in frontmatter values. Retry those values as YAML block scalars so existing
// config files keep working.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const frontmatter = match[1]
  const result = frontmatter.split(/\r?\n/).flatMap((line) => {
    if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!entry) return [line]
    const value = entry[2].trim()
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) return [line]
    if (!value.includes(":") && !/^[[{].*[\]}]\s*\S/.test(value)) return [line]
    return [`${entry[1]}: |-`, `  ${value}`]
  })
  return content.replace(frontmatter, () => result.join("\n"))
}

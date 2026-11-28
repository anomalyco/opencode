export * as ConfigMarkdown from "./markdown.js"

import matter from "gray-matter"

// gray-matter ships a JavaScript engine that evals `---javascript` and
// `---js` frontmatter blocks. Agent, command, and skill files are read from
// disk, including cloned repos, so refuse them: parsing such a block throws
// instead of executing code.
function rejectJavascript(): object {
  throw new Error("javascript frontmatter is not supported")
}

const options = {
  engines: {
    javascript: rejectJavascript,
    js: rejectJavascript,
  },
}

export function parse(content: string) {
  // Passing options bypasses gray-matter's module-global content cache, which
  // it populates before parsing: a failed YAML parse poisons the entry and
  // every later parse of the same content replays it without throwing, so the
  // sanitize fallback below never runs. Upstream: jonschlinkert/gray-matter#166.
  try {
    return matter(content, options)
  } catch {
    return matter(sanitize(content), options)
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
// config files keep working without rewriting valid YAML flow collections.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const frontmatter = match[1]
  let flow: FlowState | undefined
  const result = frontmatter.split(/\r?\n/).flatMap((line) => {
    if (flow) {
      flow = scanFlow(line, flow).state
      return [line]
    }
    if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!entry) return [line]
    const value = entry[2].trim()
    if (value === "" || value.startsWith('"') || value.startsWith("'")) return [line]
    if (value.startsWith("[") || value.startsWith("{")) {
      const scan = scanFlow(value, { stack: [], quote: undefined })
      if (scan.status === "open") flow = scan.state
      if (scan.status !== "trailing") return [line]
      return [`${entry[1]}: |-`, `  ${value}`]
    }
    if (!value.includes(":") || isValidYaml(line)) return [line]
    return [`${entry[1]}: |-`, `  ${value}`]
  })
  return content.replace(frontmatter, () => result.join("\n"))
}

function isValidYaml(line: string) {
  try {
    matter(`---\n${line}\n---`, options)
    return true
  } catch {
    return false
  }
}

type FlowState = {
  stack: Array<"]" | "}">
  quote: '"' | "'" | undefined
}

function scanFlow(text: string, state: FlowState) {
  const stack = [...state.stack]
  let quote = state.quote
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote === '"') {
      if (ch === "\\") {
        i++
        continue
      }
      if (ch === '"') quote = undefined
      continue
    }
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i++
          continue
        }
        quote = undefined
      }
      continue
    }
    if ((ch === '"' || ch === "'") && (i === 0 || /[\s[{,:]/.test(text[i - 1]))) {
      quote = ch
      continue
    }
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) break
    if (ch === "[") {
      stack.push("]")
      continue
    }
    if (ch === "{") {
      stack.push("}")
      continue
    }
    if (ch === "]" || ch === "}") {
      if (stack.at(-1) !== ch) return { status: "invalid" as const, state: undefined }
      stack.pop()
      if (stack.length === 0) {
        const rest = text.slice(i + 1).trim()
        if (rest === "" || rest.startsWith("#")) return { status: "closed" as const, state: undefined }
        return { status: "trailing" as const, state: undefined }
      }
    }
  }
  return { status: "open" as const, state: { stack, quote } }
}

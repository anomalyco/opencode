export type ToolSpec = {
  name: string
  description: string
}

export type PlannedCall = {
  name: string
  arguments: Record<string, unknown>
}

export type Plan = {
  calls: PlannedCall[]
  reason: string
}

const start = String.raw`(?<![\p{L}\p{N}_])`
const end = String.raw`(?![\p{L}\p{N}_])`
const word = (alternatives: string) => new RegExp(`${start}(?:${alternatives})${end}`, "iu")

const readIntent = word("прочитай|прочесть|покажи|открой|посмотри|содержимое|read|show|open|cat")
const listIntent = word("список файлов|файлы в|что в папке|list files|ls|directory")
const globIntent = word("найди файлы|найди все файлы|все файлы|glob|find files")
const grepIntent = word("найди|поищи|search|grep|где используется|где определено")
const bashIntent = word(
  "выполни|запусти|run|execute|bash|shell|команд[ау]|git|npm|bun|pnpm|yarn|pytest|тесты|make|docker",
)
const writeIntent = word("создай файл|запиши|create file|write file")
const editIntent = word("измени|замени|исправь|edit|replace|patch")
const fetchIntent = word("открой ссылку|загрузи|fetch|https?|url")

const pathPattern = /(?:^|[\s(«"'])([\w./@-]*\/[\w./@-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|toml|yaml|yml|css|html|py|go|rs|java|sh|txt))(?=$|[\s)»"',:;])/i

export function planToolCalls(tools: ToolSpec[], text: string): Plan {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const resolve = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const exact = byName.get(candidate)
      if (exact) return exact.name
    }
    for (const candidate of candidates) {
      const partial = tools.find((tool) => tool.name.toLowerCase().includes(candidate.toLowerCase()))
      if (partial) return partial.name
    }
    return
  }

  const path = text.match(pathPattern)?.[1]
  const quoted = text.match(/[`"«']([^`"»']{2,200})[`"»']/)?.[1]
  const url = text.match(/https?:\/\/[^\s)`"']+/)?.[0]

  if (fetchIntent.test(text) && url) {
    const name = resolve("webfetch", "fetch", "web_fetch", "read_url")
    if (name) return { calls: [{ name, arguments: { url } }], reason: "webfetch intent" }
  }

  if (writeIntent.test(text) && path) {
    const name = resolve("write", "create", "write_file")
    if (name) return { calls: [{ name, arguments: { filePath: path, path, content: quoted ?? "" } }], reason: "write intent" }
  }

  if (editIntent.test(text) && path) {
    const name = resolve("edit", "patch", "replace")
    if (name) return { calls: [{ name, arguments: { filePath: path, path, oldString: "", newString: "" } }], reason: "edit intent" }
  }

  if (bashIntent.test(text)) {
    const name = resolve("bash", "shell", "run_command", "execute")
    if (name) {
      const command = extractCommand(text)
      if (command) return { calls: [{ name, arguments: { command } }], reason: "shell intent" }
    }
  }

  if (globIntent.test(text)) {
    const name = resolve("glob", "list_files", "list")
    if (name) return { calls: [{ name, arguments: { pattern: extractGlob(text) } }], reason: "glob intent" }
  }

  if (grepIntent.test(text) && !readIntent.test(text)) {
    const name = resolve("grep", "search", "ripgrep")
    if (name) {
      const pattern = quoted ?? extractPattern(text)
      if (pattern) return { calls: [{ name, arguments: { pattern, ...(path ? { path } : {}) } }], reason: "grep intent" }
    }
  }

  if (listIntent.test(text)) {
    const name = resolve("list", "glob", "list_files")
    if (name) return { calls: [{ name, arguments: { path: path ?? "." } }], reason: "list intent" }
  }

  if (readIntent.test(text)) {
    if (path) {
      const name = resolve("read", "read_file", "cat")
      if (name) {
        const offset = text.match(/\b(?:строк[иа]?|lines?)\s+(\d+)\s*(?:[-–]\s*(\d+))?/i)
        const limit = offset?.[2] ? Number(offset[2]) - Number(offset[1]) + 1 : undefined
        return {
          calls: [
            {
              name,
              arguments: {
                filePath: path,
                path,
                ...(offset?.[1] ? { offset: Number(offset[1]) } : {}),
                ...(limit ? { limit } : {}),
              },
            },
          ],
          reason: "read intent",
        }
      }
    }

    const name = resolve("glob", "list", "list_files")
    if (name) return { calls: [{ name, arguments: { pattern: "*" } }], reason: "read without path" }
  }

  return { calls: [], reason: "no tool intent" }
}

function extractCommand(text: string): string | undefined {
  const fenced = text.match(/```[a-z]*\n([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) return fenced

  const afterVerb = text.match(
    /(?:выполни|запусти|run|execute)\s+["`']?([^"`'\n]+?)["`']?\s*$/iu,
  )?.[1]
  if (afterVerb?.trim()) return afterVerb.trim()

  const known = text.match(
    /(?:^|[\s`"'])((?:git|npm|bun|pnpm|yarn|pytest|make|docker|ls|cat|grep|find)\b[^\n]*)/iu,
  )?.[1]
  return known?.trim()
}

function extractGlob(text: string): string {
  const pattern = text.match(/(\*\*?\/?[^\s,;:]+|\*\.\w+)/)?.[1]
  return pattern ?? "**/*"
}

function extractPattern(text: string): string | undefined {
  const after = text.match(
    /(?:найди|поищи|search|grep|где используется)\s+[«"']?([^«»"'\n]{2,80})/iu,
  )?.[1]
  return after?.trim()
}

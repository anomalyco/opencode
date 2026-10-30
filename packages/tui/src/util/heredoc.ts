import path from "node:path"
import type { SimpleHighlight } from "@opentui/core"
import { filetype } from "./filetype"

export type Heredoc = {
  // The body, between the line holding `<<DELIM` and the closing DELIM line, as string offsets.
  start: number
  end: number
  language?: string
}

const OPERATOR = /(?<!<)<<(?!<)(-?)[ \t]*(\\?)(['"]?)([A-Za-z_][\w.-]*)\3/g

// Every terminated heredoc in a shell command. tree-sitter-bash marks a heredoc body but does not
// say what language it holds, so the language comes from the command that reads it.
export function heredocs(command: string): Heredoc[] {
  const result: Heredoc[] = []
  let cursor = 0
  while (cursor < command.length) {
    const lineEnd = command.indexOf("\n", cursor)
    if (lineEnd < 0) break
    const line = command.slice(cursor, lineEnd)
    let bodyStart = lineEnd + 1
    for (const match of line.matchAll(OPERATOR)) {
      const closing = closingLine(command, bodyStart, match[4], match[1] === "-")
      if (!closing) continue
      if (closing.start > bodyStart) {
        const end = closing.start - 1
        result.push({
          start: bodyStart,
          end,
          language: heredocLanguage(
            command.slice(0, cursor + (match.index ?? 0)),
            line.slice((match.index ?? 0) + match[0].length),
            command.slice(bodyStart, end),
          ),
        })
      }
      bodyStart = closing.end
    }
    cursor = bodyStart > lineEnd + 1 ? bodyStart : lineEnd + 1
  }
  return result
}

function closingLine(command: string, from: number, delimiter: string, tabs: boolean) {
  const pattern = new RegExp(`^${tabs ? "\\t*" : ""}${delimiter.replace(/[.-]/g, "\\$&")}[ \\t);'"]*$`)
  let start = from
  while (start <= command.length) {
    const newline = command.indexOf("\n", start)
    const end = newline < 0 ? command.length : newline
    if (pattern.test(command.slice(start, end))) return { start, end: end + 1 }
    if (newline < 0) return
    start = newline + 1
  }
}

const WRAPPERS = new Set(["sudo", "env", "exec", "time", "timeout", "nice", "nohup", "command", "stdbuf", "doas"])
const WRAPPER_ARGUMENT = new Set(["-u", "-g", "-n", "-s", "-k", "-C"])
const CONTAINERS = new Set([
  "ssh",
  "docker",
  "podman",
  "kubectl",
  "uv",
  "uvx",
  "poetry",
  "pipenv",
  "bundle",
  "npx",
  "bunx",
])

const COMMANDS: Record<string, string> = {
  python: "python",
  python3: "python",
  pypy: "python",
  pypy3: "python",
  uv: "python",
  ipython: "python",
  node: "javascript",
  bun: "typescript",
  deno: "typescript",
  tsx: "typescript",
  "ts-node": "typescript",
  ruby: "ruby",
  irb: "ruby",
  bundle: "ruby",
  rails: "ruby",
  perl: "perl",
  php: "php",
  lua: "lua",
  sqlite3: "sql",
  sqlcipher: "sql",
  psql: "sql",
  mysql: "sql",
  mariadb: "sql",
  duckdb: "sql",
  "clickhouse-client": "sql",
  jq: "json",
  curl: "json",
  http: "json",
  kubectl: "yaml",
  yq: "yaml",
  bash: "bash",
  sh: "bash",
  zsh: "bash",
  dash: "bash",
  ksh: "bash",
  ssh: "bash",
  gh: "markdown",
  glab: "markdown",
  patch: "diff",
}

// The language of a heredoc body, from the command that consumes it. `before` is the command text
// up to `<<`, `after` the rest of that line. Unknown consumers give undefined rather than a guess.
export function heredocLanguage(before: string, after: string, body: string): string | undefined {
  const segment =
    before
      .replace(/\\\n/g, " ")
      .split(/;|&&|\|\||\||\n|\$\(|`|\(|\{/)
      .pop() ?? ""
  const words = commandWords(segment)
  const command = words[0] ? path.basename(words[0]) : undefined
  if (command === "cat" || command === "tee") {
    const target =
      command === "tee"
        ? words.slice(1).find((word) => !word.startsWith("-"))
        : (redirectTarget(segment) ?? redirectTarget(after))
    if (target) return fileLanguage(target) ?? shebang(body)
    const consumer = after.match(/\|\s*([^|;&]+)/)
    if (consumer) return heredocLanguage(consumer[1], "", body)
    return shebang(body)
  }
  if (command === "git") return words.includes("apply") ? "diff" : "markdown"
  if (command && CONTAINERS.has(command)) {
    const inner = words
      .slice(1)
      .map((word) => path.basename(word))
      .find((word) => COMMANDS[word] && !CONTAINERS.has(word))
    if (inner) return COMMANDS[inner]
  }
  if (command && COMMANDS[command]) return COMMANDS[command]
  if (command && /^python\d+(\.\d+)?$/.test(command)) return "python"
  return shebang(body)
}

function commandWords(segment: string) {
  const words = segment.trim().split(/\s+/).filter(Boolean)
  const result: string[] = []
  let wrapped = false
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    if (result.length === 0) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue
      if (WRAPPERS.has(word)) {
        wrapped = true
        continue
      }
      if (wrapped && word.startsWith("-")) {
        if (WRAPPER_ARGUMENT.has(word)) index++
        continue
      }
      if (wrapped && /^\d+(\.\d+)?[smhd]?$/.test(word)) continue
    }
    result.push(word.replace(/^['"]|['"]$/g, ""))
  }
  return result
}

function redirectTarget(segment: string) {
  const target = segment.match(/(?<![0-9&])>>?\s*(['"]?)([^\s'"<>|;&]+)\1/)?.[2]
  return target?.startsWith("/dev/") ? undefined : target
}

function fileLanguage(file: string) {
  const language = filetype(file)
  return language === "none" ? undefined : language
}

function shebang(body: string) {
  const first = body.slice(0, body.indexOf("\n") < 0 ? body.length : body.indexOf("\n"))
  if (!first.startsWith("#!")) return
  const interpreter = first
    .slice(2)
    .trim()
    .split(/\s+/)
    .map((word) => path.basename(word))
    .find((word) => word !== "env" && !word.startsWith("-"))
  if (!interpreter) return
  return COMMANDS[interpreter] ?? (/^python\d+(\.\d+)?$/.test(interpreter) ? "python" : undefined)
}

// The bash highlights with each heredoc body recolored in its own language, bash included for a
// body run by a shell. A body whose language has no parser, or that the worker cannot highlight,
// keeps bash's string color.
export async function highlightHeredocs(
  highlights: SimpleHighlight[],
  content: string,
  highlightOnce: (content: string, filetype: string) => Promise<{ highlights?: SimpleHighlight[] }>,
): Promise<SimpleHighlight[] | undefined> {
  const bodies = heredocs(content).filter((heredoc) => heredoc.language)
  if (bodies.length === 0) return
  const injected = await Promise.all(
    bodies.map((heredoc) =>
      highlightOnce(content.slice(heredoc.start, heredoc.end), heredoc.language!).then(
        (result) => ({ heredoc, highlights: result.highlights ?? [] }),
        () => ({ heredoc, highlights: [] as SimpleHighlight[] }),
      ),
    ),
  )
  const result = injected.reduce(
    (merged, item) =>
      item.highlights.length === 0
        ? merged
        : [
            ...clip(merged, item.heredoc.start, item.heredoc.end),
            ...item.highlights.map(
              ([start, end, group, meta]): SimpleHighlight =>
                meta
                  ? [start + item.heredoc.start, end + item.heredoc.start, group, meta]
                  : [start + item.heredoc.start, end + item.heredoc.start, group],
            ),
          ],
    highlights,
  )
  if (result === highlights) return
  return result.toSorted((a, b) => a[0] - b[0])
}

function clip(highlights: SimpleHighlight[], start: number, end: number) {
  return highlights.flatMap((highlight): SimpleHighlight[] => {
    if (highlight[1] <= start || highlight[0] >= end) return [highlight]
    const outside: SimpleHighlight[] = []
    if (highlight[0] < start)
      outside.push(
        highlight[3] ? [highlight[0], start, highlight[2], highlight[3]] : [highlight[0], start, highlight[2]],
      )
    if (highlight[1] > end)
      outside.push(highlight[3] ? [end, highlight[1], highlight[2], highlight[3]] : [end, highlight[1], highlight[2]])
    return outside
  })
}

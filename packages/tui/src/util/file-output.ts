import path from "node:path"
import { filetype } from "./filetype"
import { detectOutputLanguage, OUTPUT_LANGUAGE_LIMIT } from "./tool-output"

// Tool output that shows the contents of files, split into what is colored and what is not.
// Every output line has a `gutter`: how many leading characters are a prefix the tool added (a
// path, a line number, a header line), drawn muted. The rest of the line is code, in `chunk`'s
// language; a line without a chunk is drawn plain. A chunk gathers the lines of one file (or one
// snippet) so the parser sees them together, the way they sit in the file.
export type FileOutputLine = { gutter: number; chunk?: number }
export type FileOutputModel = {
  lines: string[]
  info: FileOutputLine[]
  chunks: { language: string; lines: number[] }[]
}

// Only this many chunks are highlighted; the rest of a very wide search stays plain.
export const FILE_OUTPUT_CHUNKS = 64

// Commands whose output is the content of the files they are given, or lines of it.
const READERS = new Set(["cat", "head", "tail", "sed", "nl", "bat", "batcat", "less", "more", "tac", "awk", "cut"])
// Search commands: their first argument is a pattern, the rest are files or directories.
const SEARCHERS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"])
// Commands that leave the output of the stage before them as file content.
const FILTERS = new Set([...READERS, ...SEARCHERS, "sort", "uniq", "column", "expand", "fold"])
// Commands that print nothing, or only a separator between reads.
const SILENT = new Set(["cd", "pushd", "popd", "export", "set", "unset", "true", ":", "mkdir", "echo", "printf"])
const WRAPPERS = new Set(["sudo", "env", "exec", "time", "timeout", "nice", "nohup", "command", "stdbuf"])
// Options that take a value in a separate word, per command, so the value is not taken for a file.
const SEARCH_VALUES = ["-e", "-f", "-m", "-A", "-B", "-C", "--regexp", "--file", "--max-count", "--context"]
const VALUE_OPTIONS: Record<string, Set<string>> = {
  head: new Set(["-n", "-c", "--lines", "--bytes"]),
  tail: new Set(["-n", "-c", "--lines", "--bytes"]),
  sed: new Set(["-e", "-f", "--expression", "--file"]),
  awk: new Set(["-f", "-v", "-F"]),
  cut: new Set(["-d", "-f", "-c", "-b", "--delimiter", "--fields"]),
  nl: new Set(["-b", "-s", "-w", "-v", "-i", "-n"]),
  grep: new Set([...SEARCH_VALUES, "--include", "--exclude", "--exclude-dir"]),
  egrep: new Set([...SEARCH_VALUES, "--include", "--exclude", "--exclude-dir"]),
  fgrep: new Set([...SEARCH_VALUES, "--include", "--exclude", "--exclude-dir"]),
  rg: new Set([...SEARCH_VALUES, "-g", "-t", "-T", "-M", "--glob", "--iglob", "--type", "--type-not", "--max-columns"]),
  ag: new Set([...SEARCH_VALUES, "-G", "--file-search-regex"]),
  ack: new Set([...SEARCH_VALUES, "--type"]),
}
const RG_TYPES: Record<string, string> = {
  ts: "typescript",
  js: "typescript",
  py: "python",
  go: "go",
  rust: "rust",
  rb: "ruby",
  ruby: "ruby",
  md: "markdown",
  markdown: "markdown",
  json: "json",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  c: "c",
  cpp: "cpp",
  java: "java",
  lua: "lua",
  php: "php",
  sql: "sql",
  css: "css",
  html: "html",
}

const PATH_LINE_NUMBER = /^([^\s:]+?\.[A-Za-z0-9]+|[^\s:]*\/(?:Dockerfile|Makefile|Gemfile|Rakefile))([:-])(\d+)\2/
const PATH_CONTENT = /^([^\s:]+?\.[A-Za-z0-9]+):(?!\d)/
const NUMBER_GUTTER = /^(\s*\d+(?::\s?|\t|-))/
const RG_HEADING = /^[\w./~@+-]*[\w~@+-]\.[A-Za-z0-9]+$/
const DIFF_START = /^(diff --git |--- \S.*\n\+\+\+ |Index: \S.*\n=+\n)/

// A bash call's output, by the shape of its lines and the files its command reads.
export function bashOutputModel(command: string, output: string) {
  if (!output || output.length > OUTPUT_LANGUAGE_LIMIT) return
  const fromCommand = commandLanguage(command)
  const shaped = shapedModel(output, fromCommand)
  if (shaped) return shaped
  const language = fromCommand ?? sniffLanguage(output)
  return language ? wholeModel(output, language) : undefined
}

// A plugin or MCP tool's output that `syntax.tool_output` left alone: GitHub code search results,
// docs with fenced code blocks, and the line shapes of a search.
export function genericOutputModel(output: string) {
  if (!output || output.length > OUTPUT_LANGUAGE_LIMIT) return
  return codeSearchModel(output) ?? shapedModel(output, undefined) ?? fencedModel(output)
}

// What a read call shows: the file's `N: line` lines and the read tool's closing note, without the
// `<path>`, `<type>` and `<content>` wrapper the model reads.
export function readDisplay(output: string) {
  const start = output.indexOf("<content>\n")
  if (start < 0) return output
  const end = output.lastIndexOf("\n</content>")
  return output.slice(start + "<content>\n".length, end > start ? end : undefined).replace(/\s+$/, "")
}

// A read call's lines: `N: line`, the number muted and the line in the file's language.
export function readOutputModel(filePath: string | undefined, output: string) {
  if (!output || output.length > OUTPUT_LANGUAGE_LIMIT || !/^\d+: /m.test(output)) return
  const lines = output.split("\n")
  const language = known(detectFiletype(filePath))
  const model = empty(lines)
  const chunk = language ? addChunk(model, language) : undefined
  lines.forEach((line, index) => {
    const gutter = line.match(/^\d+: /)?.[0].length
    if (gutter === undefined) return (model.info[index] = { gutter: line.length })
    model.info[index] = { gutter, chunk }
    if (chunk !== undefined) model.chunks[chunk].lines.push(index)
  })
  return model
}

// The grep tool's output: `Found N matches`, then a `path:` line and `  Line N: text` lines per file.
export function grepToolOutputModel(output: string) {
  if (!output || output.length > OUTPUT_LANGUAGE_LIMIT) return
  const lines = output.split("\n")
  const model = empty(lines)
  let chunk: number | undefined
  lines.forEach((line, index) => {
    const match = line.match(/^(\s+Line \d+: )/)
    if (match) {
      model.info[index] = { gutter: match[1].length, chunk }
      if (chunk !== undefined) model.chunks[chunk].lines.push(index)
      return
    }
    model.info[index] = { gutter: line.length }
    if (/\S:$/.test(line)) {
      const language = known(detectFiletype(line.slice(0, -1)))
      chunk = language ? addChunk(model, language) : undefined
    }
  })
  return model.chunks.length > 0 ? model : undefined
}

// `path:12:code`, `path-12-code` (a context line), `path:code`, rg's headings, and `12:code` or
// `   12\tcode` gutters. A path names each line's language; a bare gutter takes the command's.
function shapedModel(output: string, fallback: string | undefined): FileOutputModel | undefined {
  const lines = output.split("\n")
  const filled = lines.filter((line) => line.trim() && line !== "--")
  if (filled.length === 0) return
  const share = (pattern: RegExp) => filled.filter((line) => pattern.test(line)).length / filled.length

  if (share(PATH_LINE_NUMBER) >= 0.6) return perLine(lines, (line) => line.match(PATH_LINE_NUMBER)?.[0], pathOf)
  const headings = lines.filter((line, index) => RG_HEADING.test(line) && /^\d+[:-]/.test(lines[index + 1] ?? ""))
  if (headings.length > 0 && share(/^\d+[:-]|^[\w./~@+-]+\.[A-Za-z0-9]+$/) >= 0.8) return headingModel(lines)
  if (filled.length >= 2 && share(PATH_CONTENT) >= 0.6) {
    const model = perLine(
      lines,
      (line) => line.match(PATH_CONTENT)?.[0],
      (prefix) => prefix.slice(0, -1),
    )
    if (model) return model
  }
  if (fallback && share(NUMBER_GUTTER) >= 0.6) {
    const model = empty(lines)
    const chunk = addChunk(model, fallback)
    lines.forEach((line, index) => {
      const gutter = line.match(NUMBER_GUTTER)?.[1].length ?? 0
      model.info[index] = { gutter, chunk }
      model.chunks[chunk].lines.push(index)
    })
    return model
  }
}

function pathOf(prefix: string) {
  return prefix.match(PATH_LINE_NUMBER)?.[1] ?? prefix
}

// Lines whose prefix names their file; one chunk per run of lines from the same file.
function perLine(lines: string[], prefix: (line: string) => string | undefined, file: (prefix: string) => string) {
  const model = empty(lines)
  let current: { file: string; chunk?: number } | undefined
  lines.forEach((line, index) => {
    const found = prefix(line)
    if (found === undefined) return (model.info[index] = { gutter: line === "--" ? line.length : 0 })
    const name = file(found)
    if (current?.file !== name) {
      const language = known(detectFiletype(name))
      current = { file: name, chunk: language ? addChunk(model, language) : undefined }
    }
    model.info[index] = { gutter: found.length, chunk: current.chunk }
    if (current.chunk !== undefined) model.chunks[current.chunk].lines.push(index)
  })
  return model.chunks.length > 0 ? model : undefined
}

// rg's default output on a terminal-less run of `--heading`: a path line, then `12:code` lines.
function headingModel(lines: string[]) {
  const model = empty(lines)
  let chunk: number | undefined
  lines.forEach((line, index) => {
    const gutter = line.match(/^\d+[:-]/)?.[0].length
    if (gutter !== undefined) {
      model.info[index] = { gutter, chunk }
      if (chunk !== undefined) model.chunks[chunk].lines.push(index)
      return
    }
    model.info[index] = { gutter: line.length }
    if (RG_HEADING.test(line)) {
      const language = known(detectFiletype(line))
      chunk = language ? addChunk(model, language) : undefined
    }
    if (!line.trim()) chunk = undefined
  })
  return model.chunks.length > 0 ? model : undefined
}

// grep_app's results: `Repository:`, `Path:`, `URL:`, `License:` and `Snippets:` lines, then each
// `--- Snippet N (Line X) ---` followed by the snippet's code, in the language of its `Path:`.
function codeSearchModel(output: string) {
  if (!/^Repository: .*\nPath: /m.test(output) || !output.includes("--- Snippet ")) return
  const lines = output.split("\n")
  const model = empty(lines)
  let language: string | undefined
  let chunk: number | undefined
  lines.forEach((line, index) => {
    const header = /^(Repository|Path|URL|License|Snippets):/.test(line) || /^--- Snippet \d+/.test(line)
    if (header) {
      model.info[index] = { gutter: line.length }
      if (line.startsWith("Path: ")) language = known(detectFiletype(line.slice(6).trim()))
      if (line.startsWith("Repository:")) language = undefined
      chunk = line.startsWith("--- Snippet") && language ? addChunk(model, language) : undefined
      return
    }
    model.info[index] = { gutter: 0, chunk }
    if (chunk !== undefined) model.chunks[chunk].lines.push(index)
  })
  return model.chunks.length > 0 ? model : undefined
}

// Docs with a fenced code block that names its language (context7, code search tools) read as
// markdown, which colors each fenced block in its own language.
function fencedModel(output: string) {
  if (!/^ *```[\w+#.-]+ *$/m.test(output)) return
  return wholeModel(output, "markdown")
}

// The one language of the files a command reads, when every file it names has the same one and
// nothing else in it prints. Search commands also count a `--type` or `--glob` of one language.
export function commandLanguage(command: string) {
  const languages = new Set<string>()
  for (const parts of pipelines(command.replace(/\\\n/g, " "))) {
    for (const [position, part] of parts.entries()) {
      const words = commandWords(part)
      const name = words[0] ? path.basename(words[0]) : undefined
      if (!name) continue
      if (name === "git" && words[1] === "show") {
        const target = words.slice(2).find((word) => /^[^-][^:]*:.+/.test(word))
        if (!target) return
        const language = known(detectFiletype(target.slice(target.indexOf(":") + 1)))
        if (!language) return
        languages.add(language)
        continue
      }
      if (SILENT.has(name) && position === 0) continue
      // A stage reading the one before keeps it file content only if it is a filter.
      if (!(position > 0 ? FILTERS.has(name) : READERS.has(name) || SEARCHERS.has(name))) return
      const found = files(name, words)
      if (found.includes(undefined)) return
      found.forEach((language) => languages.add(language!))
    }
  }
  return languages.size === 1 ? [...languages][0] : undefined
}

// The languages of the files a reader or search command is given, `undefined` for a file whose
// language is unknown. A directory or a pattern adds nothing.
function files(name: string, words: string[]) {
  const result: (string | undefined)[] = []
  const search = SEARCHERS.has(name) || name === "sed" || name === "awk"
  let pattern = search && !words.some((word) => ["-e", "--regexp", "-f", "--file"].includes(word))
  for (let index = 1; index < words.length; index++) {
    const word = words[index]
    if (word === "--") continue
    if (word.startsWith("-")) {
      const [option, inline] = word.includes("=") ? word.split("=", 2) : [word, undefined]
      const value = inline ?? (VALUE_OPTIONS[name]?.has(option) ? words[++index] : undefined)
      if (value && (option === "-t" || option === "--type")) result.push(RG_TYPES[value])
      if (value && (option === "-g" || option === "--glob" || option === "--include") && !value.startsWith("!"))
        result.push(...globLanguages(value))
      continue
    }
    if (word.startsWith("<") || word.startsWith(">") || /^\d?>/.test(word)) {
      if (/^<\S/.test(word)) result.push(known(detectFiletype(word.slice(1))))
      if (word === "<") result.push(known(detectFiletype(words[++index])))
      else if (/^\d?>+$/.test(word)) index++
      continue
    }
    if (pattern) {
      pattern = false
      continue
    }
    // A directory, `.` or a word with no extension names no single language.
    if (!path.extname(word) && !known(detectFiletype(word))) continue
    result.push(known(detectFiletype(word)))
  }
  return result
}

// The languages of the files a glob such as `*.ts`, `src/**/*.rs` or `*.{ts,tsx}` matches.
function globLanguages(glob: string) {
  const name = glob.replace(/^.*[*/]/, "file")
  const braces = name.match(/^(.*)\{([^}]*)\}(.*)$/)
  const names = braces ? braces[2].split(",").map((part) => braces[1] + part + braces[3]) : [name]
  return names.map((file) => known(detectFiletype(file)))
}

// The command's pipelines, each a list of its stages, split on `;`, `&&`, `||`, `|` and newlines
// outside quotes.
function pipelines(command: string) {
  const result: string[][] = [[""]]
  let quote: string | undefined
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    const current = result[result.length - 1]
    if (quote) {
      current[current.length - 1] += char
      if (char === "\\" && quote === '"') current[current.length - 1] += command[++index] ?? ""
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') quote = char
    const pair = command.slice(index, index + 2)
    if (pair === "&&" || pair === "||") {
      result.push([""])
      index++
      continue
    }
    if (char === ";" || char === "\n") {
      result.push([""])
      continue
    }
    if (char === "|") {
      current.push("")
      continue
    }
    current[current.length - 1] += char
  }
  return result.filter((parts) => parts.some((part) => part.trim()))
}

function commandWords(segment: string) {
  const words = (segment.trim().match(/'[^']*'|"(?:\\.|[^"])*"|\S+/g) ?? []).map((word) =>
    word.replace(/^['"]|['"]$/g, ""),
  )
  let start = 0
  while (start < words.length) {
    const word = words[start]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || WRAPPERS.has(word)) start++
    else if (start > 0 && WRAPPERS.has(words[start - 1]) && (word.startsWith("-") || /^\d+(\.\d+)?[smhd]?$/.test(word)))
      start++
    else break
  }
  return words.slice(start)
}

// Output that is a whole JSON document or a diff, whatever printed it.
function sniffLanguage(output: string) {
  if (DIFF_START.test(output)) return "diff"
  return detectOutputLanguage(output)
}

function wholeModel(output: string, language: string) {
  const lines = output.split("\n")
  const model = empty(lines)
  const chunk = addChunk(model, language)
  lines.forEach((_, index) => {
    model.info[index] = { gutter: 0, chunk }
    model.chunks[chunk].lines.push(index)
  })
  return model
}

function empty(lines: string[]): FileOutputModel {
  return { lines, info: [], chunks: [] }
}

function addChunk(model: FileOutputModel, language: string) {
  model.chunks.push({ language, lines: [] })
  return model.chunks.length - 1
}

function known(language: string | undefined) {
  return language && language !== "none" ? language : undefined
}

// Which line of the output each line of `shown` is, and where in it `shown`'s line starts: shown
// is the whole output or a collapsed preview of it. A preview keeps the first lines (the last one
// maybe cut, ending in `…`), the last lines (the first one maybe cut at its start), or both, with
// markers such as `…` or `(N more lines)` between them, which match no line.
export function previewLines(shown: string[], output: string[]) {
  const result: ({ line: number; from: number; to: number } | undefined)[] = shown.map(() => undefined)
  let head = 0
  while (head < shown.length && head < output.length) {
    const line = shown[head]
    if (line === output[head]) result[head] = { line: head, from: 0, to: line.length }
    else if (line.endsWith("…") && line.length > 1 && output[head].startsWith(line.slice(0, -1)))
      result[head] = { line: head, from: 0, to: line.length - 1 }
    else break
    head++
    if (line !== output[head - 1]) break
  }
  for (let back = 1; back <= shown.length - head && back <= output.length - head; back++) {
    const line = shown[shown.length - back]
    const source = output[output.length - back]
    if (line === source) {
      result[shown.length - back] = { line: output.length - back, from: 0, to: line.length }
      continue
    }
    if (line && source.endsWith(line))
      result[shown.length - back] = { line: output.length - back, from: source.length - line.length, to: source.length }
    break
  }
  return result
}

// The parser language for a file, by its extension, with shell scripts as bash.
function detectFiletype(file: string | undefined) {
  const language = filetype(file)
  return language === "shellscript" ? "bash" : language
}

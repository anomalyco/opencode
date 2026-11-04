import { firstMeaningfulMermaidLine, meaningfulNumberedMermaidLines, stripMermaidQuotes } from "../core/mermaid.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import type { GitGraphBranch, GitGraphCommit, GitGraphCommitType, GitGraphDiagram, GitGraphDirection } from "./types.js"

const HEADER_RE = /^gitGraph(?:\s+(LR|TB|BT))?\s*:?$/i
const ACCESSIBILITY_RE = /^acc(?:Title|Descr)(?::|\s|$)/i

export function isMermaidGitGraphDiagram(content: string): boolean {
  return HEADER_RE.test(firstMeaningfulMermaidLine(content) ?? "")
}

export function parseMermaidGitGraphDiagram(content: string): GitGraphDiagram {
  const firstLine = firstMeaningfulMermaidLine(content)
  if (!HEADER_RE.test(firstLine ?? "")) throw syntaxError(1, firstLine ?? "", "GitGraph header is required")
  const branches: GitGraphBranch[] = [{ name: "main", order: 0 }]
  const commits: GitGraphCommit[] = []
  const heads = new Map<string, string | undefined>([["main", undefined]])
  const ids = new Set<string>()
  let direction: GitGraphDirection = "LR"
  let currentBranch = "main"
  let generatedId = 1
  let inAccessibilityDescription = false
  let headerSeen = false

  for (const source of meaningfulNumberedMermaidLines(content)) {
    const line = stripComment(source.text)
    if (inAccessibilityDescription) {
      if (line === "}") inAccessibilityDescription = false
      continue
    }
    if (/^accDescr\s*\{$/i.test(line)) {
      inAccessibilityDescription = true
      continue
    }
    if (!line || ACCESSIBILITY_RE.test(line) || /^title(?:\s|$)/i.test(line)) continue

    const header = line.match(HEADER_RE)
    if (header) {
      if (headerSeen) throw syntaxError(source.lineNumber, line, "GitGraph header can only appear once")
      headerSeen = true
      direction = (header[1]?.toUpperCase() as GitGraphDirection | undefined) ?? "LR"
      continue
    }

    const [command = "", ...rest] = tokenize(line)
    const operation = command.toLowerCase()
    if (operation === "commit") {
      const shorthandMessage = rest[0]?.match(/^(["']).*\1$/) ? stripMermaidQuotes(rest.shift()!) : undefined
      const attributes = parseAttributes(rest, source.lineNumber, line, ["id", "msg", "tag", "type"])
      const id = single(attributes, "id", source.lineNumber, line) ?? `commit-${generatedId++}`
      if (!id) throw syntaxError(source.lineNumber, line, "GitGraph commit id cannot be empty")
      if (ids.has(id)) throw syntaxError(source.lineNumber, line, `Duplicate commit id "${id}"`)
      const type = parseCommitType(single(attributes, "type", source.lineNumber, line), source.lineNumber, line)
      const parent = heads.get(currentBranch)
      const message = single(attributes, "msg", source.lineNumber, line) ?? shorthandMessage
      const commit: GitGraphCommit = {
        id,
        ...(message === undefined ? {} : { message }),
        tags: attributes.get("tag") ?? [],
        type,
        branch: currentBranch,
        parents: parent === undefined ? [] : [parent],
      }
      commits.push(commit)
      ids.add(id)
      heads.set(currentBranch, id)
      continue
    }

    if (operation === "branch") {
      if (rest.length === 0) throw syntaxError(source.lineNumber, line, "GitGraph branch name cannot be empty")
      const name = stripMermaidQuotes(rest[0]!)
      if (!name) throw syntaxError(source.lineNumber, line, "GitGraph branch name cannot be empty")
      if (heads.has(name)) throw syntaxError(source.lineNumber, line, `Duplicate branch "${name}"`)
      const attributes = parseAttributes(rest.slice(1), source.lineNumber, line, ["order"])
      const orderValue = single(attributes, "order", source.lineNumber, line)
      const order = orderValue === undefined ? undefined : Number(orderValue)
      if (order !== undefined && (!Number.isInteger(order) || order < 0)) {
        throw syntaxError(source.lineNumber, line, "GitGraph branch order must be a non-negative integer")
      }
      branches.push({ name, ...(order === undefined ? {} : { order }) })
      heads.set(name, heads.get(currentBranch))
      currentBranch = name
      continue
    }

    if (operation === "checkout" || operation === "switch") {
      if (rest.length !== 1) throw syntaxError(source.lineNumber, line, `GitGraph ${operation} requires one branch`)
      const name = stripMermaidQuotes(rest[0]!)
      if (!heads.has(name)) throw syntaxError(source.lineNumber, line, `Unknown branch "${name}"`)
      currentBranch = name
      continue
    }

    if (operation === "merge") {
      if (rest.length === 0) throw syntaxError(source.lineNumber, line, "GitGraph merge requires a branch")
      const branch = stripMermaidQuotes(rest[0]!)
      if (!heads.has(branch)) throw syntaxError(source.lineNumber, line, `Unknown branch "${branch}"`)
      if (branch === currentBranch)
        throw syntaxError(source.lineNumber, line, "GitGraph cannot merge a branch into itself")
      const currentHead = heads.get(currentBranch)
      const mergedHead = heads.get(branch)
      if (currentHead === undefined)
        throw syntaxError(source.lineNumber, line, `Branch "${currentBranch}" has no commits`)
      if (mergedHead === undefined) throw syntaxError(source.lineNumber, line, `Branch "${branch}" has no commits`)
      if (currentHead === mergedHead)
        throw syntaxError(source.lineNumber, line, `Branches already share head "${mergedHead}"`)
      const attributes = parseAttributes(rest.slice(1), source.lineNumber, line, ["id", "tag", "type"])
      const id = single(attributes, "id", source.lineNumber, line) ?? `commit-${generatedId++}`
      if (ids.has(id)) throw syntaxError(source.lineNumber, line, `Duplicate commit id "${id}"`)
      const commit: GitGraphCommit = {
        id,
        tags: attributes.get("tag") ?? [],
        type: parseCommitType(single(attributes, "type", source.lineNumber, line), source.lineNumber, line),
        branch: currentBranch,
        parents: [currentHead, mergedHead],
      }
      commits.push(commit)
      ids.add(id)
      heads.set(currentBranch, id)
      continue
    }

    if (operation === "cherry-pick") {
      throw syntaxError(source.lineNumber, line, "Cherry-pick is not supported")
    }
    throw syntaxError(source.lineNumber, line)
  }

  const resolvedBranches = branches.map((branch) => {
    const head = heads.get(branch.name)
    return { ...branch, ...(head === undefined ? {} : { head }) }
  })
  return { direction, branches: orderBranches(resolvedBranches), commits }
}

function tokenize(line: string): string[] {
  const tokens: string[] = []
  let token = ""
  let quote: '"' | "'" | undefined
  for (const char of line) {
    if ((char === '"' || char === "'") && (quote === undefined || quote === char)) {
      quote = quote === char ? undefined : char
      token += char
      continue
    }
    if (/\s/.test(char) && quote === undefined) {
      if (token) tokens.push(token)
      token = ""
      continue
    }
    token += char
  }
  if (quote !== undefined) return [line]
  if (token) tokens.push(token)
  return tokens
}

function parseAttributes(
  tokens: string[],
  lineNumber: number,
  line: string,
  allowed: readonly string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (let index = 0; index < tokens.length; index += 1) {
    const keyToken = tokens[index]!
    const separator = keyToken.indexOf(":")
    const key = (separator < 0 ? keyToken : keyToken.slice(0, separator)).toLowerCase()
    if (!allowed.includes(key)) throw syntaxError(lineNumber, line, `Unsupported GitGraph attribute "${key}"`)
    const inline = separator < 0 ? "" : keyToken.slice(separator + 1)
    const valueToken = inline || tokens[++index]
    if (valueToken === undefined) throw syntaxError(lineNumber, line, `GitGraph attribute "${key}" requires a value`)
    const values = result.get(key) ?? []
    values.push(stripMermaidQuotes(valueToken))
    result.set(key, values)
  }
  return result
}

function single(attributes: Map<string, string[]>, key: string, lineNumber: number, line: string): string | undefined {
  const values = attributes.get(key)
  if (values && values.length > 1) throw syntaxError(lineNumber, line, `GitGraph attribute "${key}" cannot repeat`)
  return values?.[0]
}

function parseCommitType(value: string | undefined, lineNumber: number, line: string): GitGraphCommitType {
  if (value === undefined) return "NORMAL"
  const type = value.toUpperCase()
  if (type === "NORMAL" || type === "REVERSE" || type === "HIGHLIGHT") return type
  throw syntaxError(lineNumber, line, `Unknown GitGraph commit type "${value}"`)
}

function orderBranches(branches: GitGraphBranch[]): GitGraphBranch[] {
  const main = branches[0]!
  const rest = branches.slice(1).map((branch, index) => ({ branch, index }))
  const unordered = rest.filter(({ branch }) => branch.order === undefined)
  const ordered = rest
    .filter(({ branch }) => branch.order !== undefined)
    .sort((left, right) => left.branch.order! - right.branch.order! || left.index - right.index)
  return [main, ...unordered.map(({ branch }) => branch), ...ordered.map(({ branch }) => branch)]
}

function stripComment(value: string): string {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && (quote === undefined || quote === char)) {
      quote = quote === char ? undefined : char
      continue
    }
    if (quote === undefined && char === "%" && value[index + 1] === "%") return value.slice(0, index).trim()
  }
  return value.trim()
}

function syntaxError(lineNumber: number, sourceLine: string, reason?: string): MermaidSyntaxError {
  return new MermaidSyntaxError("gitGraph", lineNumber, sourceLine, reason)
}

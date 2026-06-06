import { parse as parseBash } from "unbash"
import type { Command, Node, Script, Word, WordPart } from "unbash"

export type { Command, Node, Script, Word } from "unbash"

export type CommandPart = { type: string; text: string }
export type ParsedCommand = { parts: CommandPart[]; source: string }

const DYNAMIC: ReadonlySet<string> = new Set([
  "SimpleExpansion",
  "ParameterExpansion",
  "CommandExpansion",
  "ArithmeticExpansion",
  "ProcessSubstitution",
  "BraceExpansion",
  "ExtendedGlob",
])

export function parse(command: string) {
  return parseBash(command)
}

type Located = { command: Command; base: string }

function* walk(node: Node | Script | undefined, base: string): Generator<Located> {
  if (!node) return
  switch (node.type) {
    case "Script":
    case "CompoundList":
      for (const statement of node.commands) yield* walk(statement, base)
      return
    case "Statement":
      yield* walk(node.command, base)
      return
    case "AndOr":
    case "Pipeline":
      for (const child of node.commands) yield* walk(child, base)
      return
    case "Subshell":
    case "BraceGroup":
      yield* walk(node.body, base)
      return
    case "If":
      yield* walk(node.clause, base)
      yield* walk(node.then, base)
      yield* walk(node.else, base)
      return
    case "For":
    case "Select":
      yield* walk(node.body, base)
      return
    case "While":
      yield* walk(node.clause, base)
      yield* walk(node.body, base)
      return
    case "Case":
      for (const item of node.items) yield* walk(item.body, base)
      return
    case "Function":
    case "Coproc":
      yield* walk(node.body, base)
      return
    case "Command":
      yield { command: node, base }
      if (node.name?.parts) for (const nested of nestedScripts(node.name)) yield* walk(nested.script, nested.source)
      for (const word of node.suffix)
        if (word.parts) for (const nested of nestedScripts(word)) yield* walk(nested.script, nested.source)
      return
  }
}

export function* commands(node: Node | Script | undefined): Generator<Command> {
  for (const located of walk(node, "")) yield located.command
}

export function commandParts(command: string): ParsedCommand[] {
  const out: ParsedCommand[] = []
  for (const { command: node, base } of walk(parse(command), command)) {
    if (node.name?.value === "[") continue
    const parts: CommandPart[] = []
    if (node.name) parts.push({ type: "command_name", text: node.name.text })
    for (const word of node.suffix) if (isToken(word)) parts.push({ type: "word", text: word.text })
    out.push({ parts, source: base.slice(node.pos, node.end).trim() })
  }
  return out
}

function scanDynamic(parts: readonly WordPart[] | undefined): boolean {
  if (!parts) return false
  for (const part of parts) {
    if (DYNAMIC.has(part.type)) return true
    if ((part.type === "DoubleQuoted" || part.type === "LocaleString") && scanDynamic(part.parts)) return true
  }
  return false
}

export function isDynamic(word: Word): boolean {
  return scanDynamic(word.parts)
}

export function pathWords(command: string): string[] {
  const out: string[] = []
  for (const cmd of commands(parse(command))) {
    if (cmd.name && !isDynamic(cmd.name)) out.push(cmd.name.value)
    for (const word of cmd.suffix) if (!isDynamic(word)) out.push(word.value)
  }
  return out
}

// Bare single-part expansions that tree-sitter-bash omits from a command's tokens
// (a brace expansion is a literal `word` to tree-sitter, so it stays a token).
const BARE: ReadonlySet<string> = new Set([
  "SimpleExpansion",
  "ParameterExpansion",
  "CommandExpansion",
  "ArithmeticExpansion",
  "ProcessSubstitution",
])

function isToken(word: Word): boolean {
  const parts = word.parts
  if (!parts) return true
  return !(parts.length === 1 && BARE.has(parts[0].type))
}

type Nested = { script: Script; source: string }

function collectScripts(parts: readonly WordPart[] | undefined, out: Nested[]): void {
  if (!parts) return
  for (const part of parts) {
    if ("script" in part && part.script) out.push({ script: part.script, source: innerSource(part) })
    if ("parts" in part && part.parts) collectScripts(part.parts as readonly WordPart[], out)
    if ("operand" in part && part.operand?.parts) collectScripts(part.operand.parts, out)
  }
}

function nestedScripts(word: Word): Nested[] {
  const out: Nested[] = []
  collectScripts(word.parts, out)
  return out
}

function innerSource(part: WordPart): string {
  const text = part.text
  if (part.type === "CommandExpansion") {
    if (text.startsWith("$(")) return text.slice(2, -1)
    if (text.startsWith("`")) return text.slice(1, -1)
    if (text.startsWith("${")) return text.slice(2, -1)
  }
  if (part.type === "ProcessSubstitution") return text.slice(2, -1)
  return text
}

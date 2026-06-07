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

export function* commands(node: Node | Script | undefined): Generator<Command> {
  if (!node) return
  switch (node.type) {
    case "Script":
    case "CompoundList":
      for (const statement of node.commands) yield* commands(statement)
      return
    case "Statement":
      yield* commands(node.command)
      return
    case "AndOr":
    case "Pipeline":
      for (const child of node.commands) yield* commands(child)
      return
    case "Subshell":
    case "BraceGroup":
      yield* commands(node.body)
      return
    case "If":
      yield* commands(node.clause)
      yield* commands(node.then)
      yield* commands(node.else)
      return
    case "For":
    case "Select":
      yield* commands(node.body)
      return
    case "While":
      yield* commands(node.clause)
      yield* commands(node.body)
      return
    case "Case":
      for (const item of node.items) yield* commands(item.body)
      return
    case "Function":
    case "Coproc":
      yield* commands(node.body)
      return
    case "Command":
      yield node
      if (node.name?.parts) for (const script of nestedScripts(node.name)) yield* commands(script)
      for (const word of node.suffix) if (word.parts) for (const script of nestedScripts(word)) yield* commands(script)
      return
  }
}

export function commandParts(command: string): ParsedCommand[] {
  const out: ParsedCommand[] = []
  for (const node of commands(parse(command))) {
    if (node.name?.value === "[") continue
    const parts: CommandPart[] = []
    if (node.name) parts.push({ type: "command_name", text: node.name.text })
    for (const word of node.suffix) if (isToken(word)) parts.push({ type: "word", text: word.text })
    out.push({ parts, source: command.slice(node.pos, node.end).trim() })
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

/** Tokenize a single command string into an unquoted argv (program + arguments). */
export function argv(command: string): string[] {
  for (const cmd of commands(parse(command))) {
    const out: string[] = cmd.name ? [cmd.name.value] : []
    for (const word of cmd.suffix) out.push(word.value)
    return out
  }
  return []
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

function nestedScripts(word: Word): Script[] {
  const out: Script[] = []
  collectScripts(word.parts, out)
  return out
}

function collectScripts(parts: readonly WordPart[] | undefined, out: Script[]): void {
  if (!parts) return
  for (const part of parts) {
    if ("script" in part && part.script) out.push(part.script)
    if ("parts" in part && part.parts) collectScripts(part.parts as readonly WordPart[], out)
    if ("operand" in part && part.operand?.parts) collectScripts(part.operand.parts, out)
  }
}

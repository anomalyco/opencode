import { parse as parseBash } from "unbash"
import type { Command, Node, Script, Word, WordPart } from "unbash"

export type { Command, Node, Script, Word } from "unbash"

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
      for (const word of wordsOf(node)) for (const script of substitutions(word)) yield* commands(script)
      return
  }
}

export function isDynamic(word: Word): boolean {
  const scan = (parts: readonly WordPart[] | undefined): boolean => {
    if (!parts) return false
    for (const part of parts) {
      if (DYNAMIC.has(part.type)) return true
      if ((part.type === "DoubleQuoted" || part.type === "LocaleString") && scan(part.parts)) return true
    }
    return false
  }
  return scan(word.parts)
}

export function pathWords(command: string): string[] {
  const out: string[] = []
  for (const cmd of commands(parse(command)))
    for (const word of wordsOf(cmd)) if (!isDynamic(word)) out.push(word.value)
  return out
}

function wordsOf(command: Command): Word[] {
  return command.name ? [command.name, ...command.suffix] : command.suffix
}

function substitutions(word: Word): Script[] {
  const scripts: Script[] = []
  const visit = (parts: readonly WordPart[] | undefined) => {
    if (!parts) return
    for (const part of parts) {
      if ("script" in part && part.script) scripts.push(part.script)
      if ("parts" in part && part.parts) visit(part.parts as readonly WordPart[])
      if ("operand" in part && part.operand?.parts) visit(part.operand.parts)
    }
  }
  visit(word.parts)
  return scripts
}

import { parse as parseBash } from "unbash"
import type { Command, Node, Redirect, Script, Word, WordPart } from "unbash"

export type { Command, Node, Script, Word } from "unbash"

export type CommandPart = { type: string; text: string; value: string }
export type ParsedCommand = { parts: CommandPart[]; source: string; pattern: string }

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
      for (const redirect of node.redirects) yield* redirectCommands(redirect)
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
    case "ArithmeticFor":
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
      for (const redirect of node.redirects) yield* redirectCommands(redirect)
      return
    case "Command":
      yield node
      if (node.name?.parts) for (const script of nestedScripts(node.name)) yield* commands(script)
      for (const word of node.suffix) if (word.parts) for (const script of nestedScripts(word)) yield* commands(script)
      for (const redirect of node.redirects) yield* redirectCommands(redirect)
      return
  }
}

export function commandParts(command: string): ParsedCommand[] {
  const out: ParsedCommand[] = []
  collectCommandParts(command, out, 0)
  return out
}

function collectCommandParts(command: string, out: ParsedCommand[], depth: number) {
  for (const node of commands(parse(command))) {
    if (node.name?.value === "[") continue
    const parts: CommandPart[] = []
    if (node.name) parts.push(part("command_name", node.name))
    for (const word of node.suffix) if (isToken(word)) parts.push(part("word", word))
    const source = command.slice(node.name?.pos ?? node.pos, node.end).trim()
    out.push({ parts, source, pattern: commandPattern(command, node, parts, source) })
    const nested = depth < 4 ? shellWrapperCommand(node) : undefined
    if (nested) collectCommandParts(nested, out, depth + 1)
  }
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
  collectPathWords(command, out, 0)
  return out
}

function collectPathWords(command: string, out: string[], depth: number) {
  const script = parse(command)
  for (const cmd of commands(script)) {
    if (cmd.name && !isDynamic(cmd.name)) out.push(wordValue(cmd.name))
    for (const word of cmd.suffix) if (!isDynamic(word)) out.push(wordValue(word))
    const nested = depth < 4 ? shellWrapperCommand(cmd) : undefined
    if (nested) collectPathWords(nested, out, depth + 1)
  }
  collectRedirectWords(script, out)
}

export function redirectWords(command: string): string[] {
  const out: string[] = []
  collectRedirectWords(parse(command), out)
  return out
}

/** Tokenize a single command string into an unquoted argv (program + arguments). */
export function argv(command: string): string[] {
  for (const cmd of commands(parse(command))) {
    const out: string[] = cmd.name ? [wordValue(cmd.name)] : []
    for (const word of cmd.suffix) out.push(wordValue(word))
    return out
  }
  return []
}

function part(type: string, word: Word): CommandPart {
  return { type, text: word.text, value: wordValue(word) }
}

function commandPattern(command: string, node: Command, parts: readonly CommandPart[], source: string): string {
  if (parts.length === 0) return source
  let pattern = parts.map((item) => item.value).join(" ")
  for (const redirect of node.redirects) pattern += " " + command.slice(redirect.pos, redirect.end).trim()
  return pattern
}

function wordValue(word: Word): string {
  const value = word.value
  return value === word.text ? unescapeBareValue(value) : value
}

function unescapeBareValue(text: string): string {
  const first = text.indexOf("\\")
  if (first === -1) return text
  let out = ""
  let start = 0
  for (let i = first; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92) continue
    out += text.slice(start, i)
    i++
    if (i >= text.length) {
      out += "\\"
      start = i
      break
    }
    if (text.charCodeAt(i) !== 10) out += text[i]
    start = i + 1
  }
  return out + text.slice(start)
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

function* redirectCommands(redirect: Redirect): Generator<Command> {
  for (const script of redirectScripts(redirect)) yield* commands(script)
}

function redirectScripts(redirect: Redirect): Script[] {
  const out: Script[] = []
  if (redirect.target?.parts) out.push(...nestedScripts(redirect.target))
  if (redirect.body?.parts) out.push(...nestedScripts(redirect.body))
  return out
}

const PATH_REDIRECT: ReadonlySet<string> = new Set([">", ">>", "<", "<>", ">|", "&>", "&>>"])

function collectRedirectWords(node: Node | Script | undefined, out: string[]): void {
  if (!node) return
  switch (node.type) {
    case "Script":
    case "CompoundList":
      for (const statement of node.commands) collectRedirectWords(statement, out)
      return
    case "Statement":
      collectRedirectTargets(node.redirects, out)
      collectRedirectWords(node.command, out)
      return
    case "AndOr":
    case "Pipeline":
      for (const child of node.commands) collectRedirectWords(child, out)
      return
    case "Subshell":
    case "BraceGroup":
      collectRedirectWords(node.body, out)
      return
    case "If":
      collectRedirectWords(node.clause, out)
      collectRedirectWords(node.then, out)
      collectRedirectWords(node.else, out)
      return
    case "For":
    case "ArithmeticFor":
    case "Select":
      collectRedirectWords(node.body, out)
      return
    case "While":
      collectRedirectWords(node.clause, out)
      collectRedirectWords(node.body, out)
      return
    case "Case":
      for (const item of node.items) collectRedirectWords(item.body, out)
      return
    case "Function":
    case "Coproc":
      collectRedirectTargets(node.redirects, out)
      collectRedirectWords(node.body, out)
      return
    case "Command":
      collectRedirectTargets(node.redirects, out)
      if (node.name?.parts) for (const script of nestedScripts(node.name)) collectRedirectWords(script, out)
      for (const word of node.suffix) if (word.parts) for (const script of nestedScripts(word)) collectRedirectWords(script, out)
      for (const redirect of node.redirects) for (const script of redirectScripts(redirect)) collectRedirectWords(script, out)
      return
  }
}

function collectRedirectTargets(redirects: readonly Redirect[], out: string[]): void {
  for (const redirect of redirects) {
    if (!PATH_REDIRECT.has(redirect.operator)) continue
    const target = redirect.target
    if (!target || isDynamic(target)) continue
    out.push(wordValue(target))
  }
}

const SHELLS: ReadonlySet<string> = new Set(["bash", "dash", "ksh", "sh", "zsh"])

function shellWrapperCommand(command: Command): string | undefined {
  if (!command.name) return
  const name = basename(wordValue(command.name))
  if (SHELLS.has(name)) return shellCommandArgument(command.suffix)
  if (name !== "env") return
  const suffix = command.suffix
  for (let i = 0; i < suffix.length; i++) {
    const value = wordValue(suffix[i])
    if (value === "--") continue
    if (value.startsWith("-")) continue
    if (isAssignment(value)) continue
    if (!SHELLS.has(basename(value))) return
    return shellCommandArgument(suffix.slice(i + 1))
  }
}

function shellCommandArgument(words: readonly Word[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const value = wordValue(words[i])
    if (value === "--") continue
    if (value.startsWith("--")) continue
    if (!value.startsWith("-")) return
    if (!value.includes("c")) continue
    const command = words[i + 1]
    if (!command || isDynamic(command)) return
    return wordValue(command)
  }
}

function basename(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))
  return slash === -1 ? value : value.slice(slash + 1)
}

function isAssignment(value: string): boolean {
  const index = value.indexOf("=")
  if (index <= 0) return false
  const first = value.charCodeAt(0)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95)) return false
  for (let i = 1; i < index; i++) {
    const code = value.charCodeAt(i)
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95)
      continue
    return false
  }
  return true
}

function collectScripts(parts: readonly WordPart[] | undefined, out: Script[]): void {
  if (!parts) return
  for (const part of parts) {
    if ("script" in part && part.script) out.push(part.script)
    if ("parts" in part && part.parts) collectScripts(part.parts as readonly WordPart[], out)
    if ("operand" in part && part.operand?.parts) collectScripts(part.operand.parts, out)
  }
}

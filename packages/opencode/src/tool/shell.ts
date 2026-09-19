import { Effect, Exit, Schedule, Stream } from "effect"
import os from "os"
import { createWriteStream, readFileSync } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import { sanitizePluginEnv } from "@/util/plugin-env"
import { Language, type Node } from "web-tree-sitter"

import { FSUtil } from "@opencode-ai/core/fs-util"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Shell } from "@opencode-ai/core/shell"
import { ShellID } from "./shell/id"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"

export { Parameters } from "./shell/prompt"

const MAX_METADATA_LENGTH = 30_000

// Bound per-chunk preview writes: every metadata call durably rewrites the full part.
const METADATA_THROTTLE_MS = 200

const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "awk",
  "gawk",
  "sed",
  "sort",
  "uniq",
  "source",
  ".",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

// Commands whose arguments are broadcast as text, never opened as local files.
const DATA = new Set(["echo", "printf"])

// Commands that run their inner command on a remote host or inside a container. Their
// arguments are not all remote though: bind mounts, copy operands, key/config files are
// local paths. `remotePaths` scans only those positions; the inner command and the
// container side of a copy stay prompt-free.
const REMOTE = new Set(["ssh", "docker", "podman", "kubectl"])

// Shells that evaluate a `-c` string as a nested command. They are not option-model
// wrappers, but the string must be re-parsed or `sh -c 'cat /etc/hostname'` runs a read
// the classifier never sees.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"])

// Node types that become classification tokens. Expansions (`$HOME`, `${X}`,
// `$(...)`) must be kept or a wrapper argument like `env -C $HOME` is dropped and
// the command after it is misread as the target.
const TOKEN_NODES = new Set([
  "command_name",
  "command_name_expr",
  "word",
  "string",
  "raw_string",
  "concatenation",
  "simple_expansion",
  "expansion",
  "command_substitution",
  "arithmetic_expansion",
  "ansi_c_string",
  // Option values (`timeout 5`, `nice -n 5`) parse as `number`; dropping them shifts
  // every later token so wrapper option-skipping lands on the wrong command.
  "number",
])

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const ANSI_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  e: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
}

// Bash cannot round-trip an out-of-range `\U` code point (it either drops the escape or
// emits raw UTF-8 bytes), so any word containing one is undecidable. This private-use
// marker survives into the argument so the path scan can anchor conservatively.
const UNRESOLVED = "\uE000"

// Bash decodes `$'…'` ANSI-C quoting (octal `\057`, hex `\x2f`, `\n`) before it runs,
// so `$'\057etc\057hostname'` reads `/etc/hostname`. The raw token must not reach the
// path scan intact or the file command looks argument-free.
function decodeAnsiC(text: string) {
  if (!text.includes("$'")) return text
  let out = ""
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "$" || text[index + 1] !== "'") {
      out += text[index]
      continue
    }
    let value = ""
    let closed = false
    for (let scan = index + 2; scan < text.length; scan++) {
      const char = text[scan]
      if (char === "'") {
        closed = true
        index = scan
        break
      }
      if (char !== "\\") {
        value += char
        continue
      }
      const rest = text.slice(scan + 1)
      const octal = /^[0-7]{1,3}/.exec(rest)
      if (octal) {
        value += String.fromCharCode(Number.parseInt(octal[0], 8))
        scan += octal[0].length
        continue
      }
      const hex = /^x([0-9A-Fa-f]{1,2})/.exec(rest)
      if (hex) {
        value += String.fromCharCode(Number.parseInt(hex[1], 16))
        scan += hex[0].length
        continue
      }
      const unicode = /^u([0-9A-Fa-f]{1,4})/.exec(rest)
      if (unicode) {
        value += String.fromCodePoint(Number.parseInt(unicode[1], 16))
        scan += unicode[0].length
        continue
      }
      const wide = /^U([0-9A-Fa-f]{1,8})/.exec(rest)
      if (wide) {
        const code = Number.parseInt(wide[1], 16)
        value += code > 0x10ffff ? UNRESOLVED : String.fromCodePoint(code)
        scan += wide[0].length
        continue
      }
      const next = rest[0]
      if (next === undefined) break
      value += ANSI_ESCAPES[next] ?? next
      scan += 1
    }
    if (!closed) return text
    out += value
  }
  return out
}

function parts(node: Node) {
  const out: Part[] = []
  let prevEnd: number | undefined
  const push = (type: string, text: string, start: number, end: number) => {
    const decoded = decodeAnsiC(text)
    const last = out[out.length - 1]
    // tree-sitter splits one shell word into adjacent nodes with no separator
    // (`"."\./x` is `string` + `word`); the shell concatenates them, so the scan must
    // see the joined word or `..` is hidden across the split.
    if (last && prevEnd !== undefined && start === prevEnd) {
      out[out.length - 1] = { type: last.type, text: last.text + decoded }
    } else {
      out.push({ type, text: decoded })
    }
    prevEnd = end
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        push(item.type, item.text, item.startIndex, item.endIndex)
      }
      continue
    }
    if (!TOKEN_NODES.has(child.type)) {
      continue
    }
    push(child.type, child.text, child.startIndex, child.endIndex)
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

// A function body is defined before the assignment its later call resolves
// (`f(){ cat $x; }; x=/etc/hostname; f`), so an offset-keyed scope excludes it. The
// body is classified with the fully-merged scope instead: conservative, and correct for
// the call that actually runs it.
function inFunction(node: Node) {
  let current: Node | null = node.parent
  while (current) {
    if (current.type === "function_definition") return true
    current = current.parent
  }
  return false
}

// Bash deletes `\<newline>` continuations before parsing, so `ca\<newline>t` runs `cat`.
// Single quotes keep the backslash literal; escapes inside double quotes are preserved.
function stripLineContinuations(text: string) {
  let out = ""
  let quote: "'" | '"' | undefined
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === "\\" && quote !== "'") {
      if (text[index + 1] === "\n") {
        index++
        continue
      }
      if (text[index + 1] === "\r" && text[index + 2] === "\n") {
        index += 2
        continue
      }
      out += char
      if (index + 1 < text.length) {
        out += text[index + 1]
        index++
      }
      continue
    }
    if (quote) {
      out += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      out += char
      continue
    }
    out += char
  }
  return out
}

function braceEnd(text: string, start: number) {
  let depth = 0
  let quote: "'" | '"' | undefined
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (char === "\\") {
      index++
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "{") depth++
    if (char === "}" && --depth === 0) return index
  }
  return -1
}

function topComma(text: string, start: number, end: number) {
  let depth = 0
  let quote: "'" | '"' | undefined
  for (let index = start; index < end; index++) {
    const char = text[index]
    if (char === "\\") {
      index++
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "{") depth++
    if (char === "}") depth--
    if (char === "," && depth === 1) return true
  }
  return false
}

const BRACE_WORD = /[A-Za-z0-9_.\/\\~=+,'"{}@%:-]/

// The word a brace group is concatenated with. Quotes are part of the word
// (`c'a't{,}` runs `cat`), so a scan that stops at a quote splits the command name and
// loses the read.
function braceWordBounds(text: string, index: number) {
  let start = index
  while (start > 0) {
    const char = text[start - 1]
    if (BRACE_WORD.test(char)) {
      start--
      continue
    }
    if (char === "'" || char === '"') {
      const open = text.lastIndexOf(char, start - 2)
      if (open < 0) break
      start = open
      continue
    }
    break
  }
  let end = index
  let quote: string | undefined
  while (end < text.length) {
    const char = text[end]
    if (char === "\\" && end + 1 < text.length) {
      end += 2
      continue
    }
    if (quote) {
      end++
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      end++
      continue
    }
    if (BRACE_WORD.test(char)) {
      end++
      continue
    }
    break
  }
  return { start, end }
}

function firstBrace(text: string) {
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === "\\") {
      index++
      continue
    }
    if (char === "$" && text[index + 1] === "{") {
      index++
      continue
    }
    if (char !== "{") continue
    const end = braceEnd(text, index)
    if (end >= 0 && topComma(text, index, end)) return index
  }
  return -1
}

function splitBraceOptions(text: string, start: number, end: number) {
  const options: string[] = []
  let acc = ""
  let depth = 0
  let quote: string | undefined
  for (let index = start + 1; index < end; index++) {
    const char = text[index]
    if (char === "\\" && index + 1 < end) {
      acc += char + text[index + 1]
      index++
      continue
    }
    if (quote) {
      acc += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      acc += char
      continue
    }
    if (char === "{") depth++
    if (char === "}") depth--
    if (char === "," && depth === 0) {
      options.push(acc)
      acc = ""
      continue
    }
    acc += char
  }
  options.push(acc)
  return options
}

// Bash multiplies out every brace group and concatenates it with the surrounding word,
// so a group nested inside an option (`c{a{t,},}`) or a second adjacent group
// (`{c,d}{at,}`) must expand too. A candidate that still contains `{…}` is not a real
// command or path, so leaving it unexpanded hides the effect from the scan.
function expandBraces(text: string, depth = 0): string[] {
  if (depth > 8) return [text]
  const start = firstBrace(text)
  if (start < 0) return [text]
  const end = braceEnd(text, start)
  if (end < 0) return [text]
  const heads = expandBraces(text.slice(0, start), depth + 1)
  const tails = expandBraces(text.slice(end + 1), depth + 1)
  const out: string[] = []
  for (const option of splitBraceOptions(text, start, end)) {
    for (const variant of expandBraces(option, depth + 1)) {
      for (const head of heads) {
        for (const tail of tails) out.push(head + variant + tail)
      }
    }
    if (out.length > 64) return [text]
  }
  return out.length > 0 ? out : [text]
}

function flattenBraces(text: string) {
  let out = ""
  let found = false
  let quote: "'" | '"' | undefined
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === "\\" && index + 1 < text.length) {
      out += char + text[index + 1]
      index += 2
      continue
    }
    if (quote) {
      out += char
      if (char === quote) quote = undefined
      index++
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      out += char
      index++
      continue
    }
    if (char !== "{" || (index > 0 && text[index - 1] === "$")) {
      out += char
      index++
      continue
    }
    const end = braceEnd(text, index)
    if (end < 0 || !topComma(text, index, end)) {
      out += char
      index++
      continue
    }
    found = true
    const bounds = braceWordBounds(text, index)
    const words = expandBraces(text.slice(bounds.start, bounds.end))
    out = out.slice(0, out.length - (index - bounds.start)) + words.join(" ") + " "
    index = bounds.end
  }
  return { text: out, found }
}

// Classification must see the tokens the shell actually executes. It must use the
// same position-free quote/escape canonicalization the persisted-grant matcher uses
// (`Wildcard.unquote`), or a command name built from quotes (`cat""`) is invisible to
// the FILES/CWD scan while still matching a stored `cat *` grant.
function unquote(text: string) {
  return Wildcard.unquote(text)
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) {
    const rest = text.slice(1)
    return process.platform === "win32" ? path.join(os.homedir(), rest) : os.homedir() + rest
  }
  return text
}

// Bash expands a leading `~name` (and `~+`/`~-`) but `home()` above only rewrites `~`
// and `~/…`. Left as-is, `~root/.ssh/id_rsa` resolves lexically under the worktree
// while the shell reads `/root/.ssh/id_rsa`, so these forms are treated as expansions.
function tildeUser(text: string) {
  const bare = text.startsWith('"') || text.startsWith("'") ? text.slice(1) : text
  return /^~[^/\\]/.test(bare)
}

const passwdHomes = new Map<string, string>()

function userHome(name: string) {
  if (process.platform === "win32" || !name) return
  const cached = passwdHomes.get(name)
  if (cached) return cached
  try {
    for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
      const fields = line.split(":")
      if (fields[0] === name && fields[5]) {
        passwdHomes.set(name, fields[5])
        return fields[5]
      }
    }
  } catch {
    return
  }
  return
}

function expandTilde(text: string, cwd: string): string | true | undefined {
  const match = /^~([^/\\]*)([/\\].*)?$/.exec(text)
  if (!match) return
  const name = match[1]
  const rest = match[2] ?? ""
  // Join without normalizing. `path.join` collapses `link/..` lexically before the
  // symlink is followed, so `~+/linkroot/../etc` would look contained while the shell
  // reads `/etc`; `rawPath` keeps the components for `resolveExistingFrom`. `~N` is a
  // directory-stack entry (normally the worktree itself, like `~+`), not a username.
  if (name === "+" || /^[0-9]+$/.test(name)) return cwd + rest
  const base = name === "-" ? process.env.OLDPWD : userHome(name)
  // `true` means the target is a real expansion whose home could not be resolved;
  // the caller forces an external-directory prompt rather than treating it as relative.
  return base ? base + rest : true
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string, vars?: Map<string, string>) {
  // All parameter expansions are resolved together and repeatedly rather than in a
  // fixed order at one offset: a default introduced *by* a variable's value
  // (`C="${X:-cat /etc/hostname}"; bash -c "$C"`) is not visible until the variable
  // itself is substituted, so the pass must run again on its own output.
  const substitute = (value: string) =>
    value
      // `${NAME:+word}` yields `word` when NAME is set. The classifier cannot observe an
      // environment variable's state, so it resolves to the word: the conservative
      // direction, and the real read when the command sets the variable itself
      // (`O=notes.txt; cat ${O:+/etc/hostname}`).
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):\+([^}]*)\}/g, (_whole, _name: string, alternate: string) => alternate)
      // `${NAME:-word}` / `${NAME:=word}` yields `word` when NAME is unset. Resolving the
      // default keeps `cat ${O:-/etc/hostname}` visible to the scan instead of leaving an
      // unresolvable expansion that the path model skips.
      .replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-|:=|-)([^}]*)\}/g,
        (_whole, name: string, fallback: string) => vars?.get(name) ?? fallback,
      )
      // One assignment can name another (`A=$B`), so resolve transitively.
      .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, name: string) => vars?.get(name) ?? whole)
  // A self-referential assignment multiplies its text on every pass (`A='$A$A…'; cat $A`),
  // so the pass cap alone leaves the working string unbounded — eight references allocate
  // 256 MB and twelve exhaust memory. Bound the working text and mark the result with the
  // unresolved sentinel so `argPath` anchors the scan at the filesystem root and fails
  // closed instead of allocating an unbounded string.
  const limit = 1 << 16
  const bounded = (value: string) => (value.length > limit ? UNRESOLVED + value.slice(0, limit) : value)
  let unquoted = bounded(substitute(unquote(text)))
  for (let pass = 0; pass < 8; pass++) {
    const next = bounded(substitute(unquoted))
    if (next === unquoted) break
    unquoted = next
  }
  const out = unquoted
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$\{?(HOME|PWD|PSHOME)\}?(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  // Pathname expansion is a shell expansion too: the argument the matcher sees
  // (`cat *`) is not the path the shell executes (`cat /etc/passwd`), so a glob
  // must never inherit a literal `always` grant.
  if (/[?*[]/.test(text)) return true
  if (!ps && tildeUser(text)) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

// A `$(...)` result consumed as an operand is program text when it looks like a command
// line: whitespace separates words, and `;`/`&`/`|`/`<`/`>`/backtick are shell control
// syntax. A bare path (`/etc/hostname`) stays a path so `O=$(echo /etc/x); cat $O` is
// still scanned by the operand path. The `\s`-only heuristic missed `cat</etc/hostname`
// (`cat < /etc/hostname` with no space), which really reads the file.
function looksLikeCommandLine(text: string) {
  return /\s/.test(text) || /[;&|<>`]/.test(text)
}

// Exec-preserving wrappers. The inner command must be resolved or the wrapper name
// becomes the grant key, the real file command is never scanned, and the tool offers an
// `always` pattern that absorbs it. Each spec records which option characters consume a
// value and how many positional arguments precede the command.
type Wrapper = {
  valueChars: string
  valueLong: Set<string>
  positionals: number
  shellString?: string
  // Options that consume an input file path (`xargs -a`, `parallel --arg-file`) must be
  // scanned: a stored wrapper grant would otherwise absorb that read.
  pathChars?: string
  pathLong?: Set<string>
}

const WRAPPERS: Record<string, Wrapper> = {
  builtin: { valueChars: "", valueLong: new Set(), positionals: 0 },
  command: { valueChars: "", valueLong: new Set(), positionals: 0 },
  exec: { valueChars: "a", valueLong: new Set(), positionals: 0 },
  nohup: { valueChars: "", valueLong: new Set(), positionals: 0 },
  time: { valueChars: "o", pathChars: "o", valueLong: new Set(["--output"]), pathLong: new Set(["--output"]), positionals: 0 },
  setsid: { valueChars: "", valueLong: new Set(["--wait"]), positionals: 0 },
  stdbuf: { valueChars: "ioe", valueLong: new Set(["--input", "--output", "--error"]), positionals: 0 },
  xargs: {
    valueChars: "InPsaEdL",
    pathChars: "a",
    valueLong: new Set([
      "--arg-file",
      "--delimiter",
      "--eof",
      "--max-args",
      "--max-chars",
      "--max-lines",
      "--max-procs",
      "--process-slot-var",
      "--replace",
    ]),
    pathLong: new Set(["--arg-file"]),
    positionals: 0,
  },
  watch: { valueChars: "n", valueLong: new Set(["--interval"]), positionals: 0 },
  nice: { valueChars: "n", valueLong: new Set(["--adjustment"]), positionals: 0 },
  ionice: { valueChars: "cnp", valueLong: new Set(["--class", "--classdata", "--pid"]), positionals: 0 },
  timeout: { valueChars: "sk", valueLong: new Set(["--signal", "--kill-after"]), positionals: 1 },
  taskset: { valueChars: "p", valueLong: new Set(["--pid"]), positionals: 1 },
  chrt: { valueChars: "", valueLong: new Set(["--pid"]), positionals: 1 },
  flock: { valueChars: "wE", valueLong: new Set(["--wait", "--conflict-exit-code"]), positionals: 1 },
  sudo: {
    valueChars: "ugpCDRTU",
    valueLong: new Set([
      "--user",
      "--group",
      "--prompt",
      "--chdir",
      "--chroot",
      "--role",
      "--type",
      "--close-from",
      "--other-user",
      "--host",
      "--login-class",
    ]),
    positionals: 0,
  },
  doas: { valueChars: "u", valueLong: new Set(), positionals: 0 },
  script: { valueChars: "", valueLong: new Set(), positionals: 0, shellString: "c" },
  parallel: {
    valueChars: "ajNS",
    pathChars: "a",
    valueLong: new Set(["--jobs", "--max-args", "--max-lines", "--arg-file", "--files"]),
    pathLong: new Set(["--arg-file"]),
    positionals: 0,
  },
  busybox: { valueChars: "", valueLong: new Set(), positionals: 0 },
  fakeroot: { valueChars: "", valueLong: new Set(), positionals: 0 },
  unshare: { valueChars: "", valueLong: new Set(), positionals: 0 },
  "ssh-agent": { valueChars: "at", valueLong: new Set(), positionals: 0 },
  "dbus-run-session": { valueChars: "", valueLong: new Set(), positionals: 0 },
  "systemd-inhibit": {
    valueChars: "",
    valueLong: new Set(["--what", "--who", "--why"]),
    positionals: 0,
  },
}

const SHELL_SPEC: Wrapper = { valueChars: "", valueLong: new Set(), positionals: 0, shellString: "c" }

type Effective = {
  name?: string
  command: Part[]
  cwdTarget?: Part
  evalScript?: string
  wrapped?: boolean
  unresolved?: boolean
  extraPaths?: string[]
}

function commandName(text: string) {
  const name = Wildcard.unquote(text)
  return name.startsWith("\\") ? name.slice(1) : name
}

// A path-qualified command (`/usr/bin/cat`, `.\bin\type`) runs the same binary as its
// bare name; lookups must normalize so an absolute path cannot dodge the FILES scan.
function bareName(text: string) {
  const slash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"))
  return slash === -1 ? text : text.slice(slash + 1)
}

// Strip one wrapper's options and positional prefixes so the next token is the command
// it runs. An option shape the spec does not model returns `unresolved` instead of
// guessing: a wrong guess would skip the real file command and hide the read.
function stripWrapperOptions(parts: Part[], spec: Wrapper) {
  const paths: string[] = []
  let index = 1
  while (index < parts.length) {
    const text = parts[index].text
    if (text === "--") {
      index++
      break
    }
    if (!text.startsWith("-") || text === "-") break
    if (text.startsWith("--")) {
      const equals = text.indexOf("=")
      if (equals !== -1) {
        // An attached `--arg-file=<path>` never reaches the space-separated path branch,
        // so its value must be scanned here or the read is invisible.
        if (spec.pathLong?.has(text.slice(0, equals))) paths.push(unquote(text.slice(equals + 1)))
        index++
        continue
      }
      if (spec.valueLong.has(text)) {
        if (spec.pathLong?.has(text)) {
          const value = parts[index + 1]?.text
          if (value !== undefined) paths.push(unquote(value))
        }
        index += 2
        continue
      }
      if (spec.shellString && text === "--command") {
        const value = parts[index + 1]?.text
        return { rest: parts.slice(index + 2), shell: value === undefined ? "" : unquote(value), wrapped: true, paths }
      }
      return { rest: parts, wrapped: true, unresolved: true, paths }
    }
    const body = text.slice(1)
    let consumed = false
    for (let position = 0; position < body.length; position++) {
      const flag = body[position]
      if (flag === spec.shellString) {
        const attached = body.slice(position + 1)
        const value = attached || parts[index + 1]?.text
        return {
          rest: parts.slice(attached ? index + 1 : index + 2),
          shell: value === undefined ? "" : unquote(value),
          wrapped: true,
          paths,
        }
      }
      if (!spec.valueChars.includes(flag)) continue
      consumed = true
      if (spec.pathChars?.includes(flag)) {
        const attached = body.slice(position + 1)
        const value = attached || parts[index + 1]?.text
        if (value !== undefined) paths.push(unquote(value))
      }
      index += position === body.length - 1 ? 2 : 1
      break
    }
    if (!consumed) index += 1
  }
  let rest = parts.slice(index)
  for (let skip = 0; skip < spec.positionals && rest.length > 0; skip++) rest = rest.slice(1)
  return { rest, wrapped: true, paths }
}

function stripEnvOptions(parts: Part[]) {
  let index = 1
  let cwdTarget: Part | undefined
  while (index < parts.length) {
    const text = parts[index].text
    if (text === "-C" || text === "--chdir") {
      cwdTarget = parts[index + 1]
      index += 2
      continue
    }
    if (text.startsWith("--chdir=")) {
      cwdTarget = { type: "word", text: text.slice(8) }
      index += 1
      continue
    }
    if (text.startsWith("-C") && text.length > 2) {
      cwdTarget = { type: "word", text: text.slice(2) }
      index += 1
      continue
    }
    if (text === "-S" || text === "--split-string") {
      const value = parts[index + 1]?.text
      return { rest: parts.slice(index + 2), cwdTarget, shell: value === undefined ? "" : unquote(value), wrapped: true }
    }
    if (text.startsWith("--split-string=")) {
      return { rest: parts.slice(index + 1), cwdTarget, shell: unquote(text.slice(15)), wrapped: true }
    }
    if (text.startsWith("-S") && text.length > 2) {
      return { rest: parts.slice(index + 1), cwdTarget, shell: unquote(text.slice(2)), wrapped: true }
    }
    if (text === "-u" || text === "--unset") {
      index += 2
      continue
    }
    if (text.startsWith("-u") && text.length > 2) {
      index += 1
      continue
    }
    if (
      text.startsWith("--unset=") ||
      text === "-i" ||
      text === "-0" ||
      text === "--ignore-environment" ||
      text === "--null" ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(text)
    ) {
      index += 1
      continue
    }
    if (text.startsWith("-") && text !== "-") {
      index += 1
      continue
    }
    break
  }
  return { rest: parts.slice(index), cwdTarget, wrapped: true }
}

// Resolve wrapper prefixes (`command cat`, `xargs cat`, `timeout 5 rm`, `env -C dir cat`)
// to the command they actually run, plus any cwd the wrapper changes. An `eval` or
// `env -S` string is handed back for the caller to re-parse. A wrapper whose options
// cannot be modelled returns `unresolved` so the caller scans conservatively.
function effective(command: Part[]): Effective {
  let parts = command
  let cwdTarget: Part | undefined
  let evalScript: string | undefined
  let wrapped = false
  let extraPaths: string[] = []
  for (let depth = 0; depth < 64 && parts.length > 0; depth++) {
    const name = bareName(commandName(parts[0].text))
    const spec = WRAPPERS[name]
    if (spec) {
      const stripped = stripWrapperOptions(parts, spec)
      wrapped = true
      if (stripped.paths?.length) extraPaths = extraPaths.concat(stripped.paths)
      if (stripped.unresolved) return { name: undefined, command, wrapped, unresolved: true }
      if (stripped.shell !== undefined) evalScript = stripped.shell
      parts = stripped.rest
      continue
    }
    if (SHELLS.has(name)) {
      const stripped = stripWrapperOptions(parts, SHELL_SPEC)
      wrapped = true
      if (stripped.paths?.length) extraPaths = extraPaths.concat(stripped.paths)
      if (stripped.unresolved) return { name: undefined, command, wrapped, unresolved: true, extraPaths }
      if (stripped.shell !== undefined) {
        return { name, command: parts, cwdTarget, evalScript: stripped.shell, wrapped: true, extraPaths }
      }
      // `sh script.sh` has no `-c` string but still reads its script argument, so keep the
      // shell as the effective command and let the conservative scan inspect the arguments.
      return { name, command: parts, cwdTarget, wrapped: true, extraPaths }
    }
    if (name === "env") {
      const stripped = stripEnvOptions(parts)
      wrapped = true
      if (stripped.shell !== undefined) evalScript = stripped.shell
      cwdTarget = stripped.cwdTarget ?? cwdTarget
      parts = stripped.rest
      continue
    }
    if (name === "eval") {
      const script = parts
        .slice(1)
        .map((item) => Wildcard.unquote(item.text))
        .join(" ")
        .trim()
      return { name, command: parts, cwdTarget, evalScript: script, wrapped: true, extraPaths }
    }
    break
  }
  if (parts.length > 0 && WRAPPERS[bareName(commandName(parts[0].text))]) {
    return { name: undefined, command, wrapped, unresolved: true, extraPaths }
  }
  return {
    name: parts.length > 0 ? bareName(commandName(parts[0].text)) : undefined,
    command: parts,
    cwdTarget,
    evalScript,
    wrapped,
    extraPaths,
  }
}

// A dynamic argument cannot be resolved to a real path, but if it still carries a
// traversal or an absolute prefix the shell may read outside the worktree, so the
// scan must anchor conservatively rather than skip the argument entirely.
function unresolvableExternal(text: string) {
  if (text.startsWith("/") || /^[A-Za-z]:[\\/]/.test(text)) return true
  // A word-splitting `$IFS` can turn one token into a path; an undecoded `$'…'` still
  // hides its bytes. Both are anchored at the filesystem root rather than skipped.
  if (/\$\{?IFS\}?/i.test(text) || text.includes("$'")) return true
  return /(^|[\\/])\.\.([\\/]|$)/.test(text)
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

// `/dev/null`, the standard streams and the fd aliases are sinks/sources, not external
// files: scanning them turns `cmd 2>/dev/null` — the most common redirect idiom — into a
// prompt for `/dev/*`.
function deviceSink(text: string) {
  return /^\/dev\/(null|zero|stdin|stdout|stderr|tty|fd\/[0-9]+)$/.test(text)
}

// Shell-synthesised numeric/positional variables. They cannot carry an absolute path,
// so a redirect target built only from them stays relative to cwd.
const RELATIVE_VAR =
  /\$(?:\$|[0-9]+|!|\?|#|\*|@|-|_|\{[0-9]+\}|\{?(?:RANDOM|SRANDOM|BASHPID|PPID|SECONDS|EPOCHSECONDS|EPOCHREALTIME|LINENO|UID|EUID|GID|EGID|SHLVL|BASH_SUBSHELL|BASH_VERSION|HOSTTYPE|OSTYPE|MACHTYPE)(?![\w])\}?)/g

function globAnchor(text: string) {
  // A leading glob has no literal prefix to resolve. Keep one placeholder segment
  // per glob metacharacter (so a trailing `..` traversal still cancels correctly),
  // then drop the final, glob-selected segment. `*` anchors at cwd; `*/../..`
  // anchors at the directory the traversal reaches, so it is still scanned.
  return path.dirname(text.replace(/[*?[\]]/g, "_"))
}

// Short options whose attached value is a pattern, separator or script rather than a
// local file. `values` are the flags that consume an attached value and `path` the
// subset naming a file; without this the generic rule invents paths for `awk -F/`,
// `gcc -Iinclude/sub` or `java -Dlog.dir=logs/app`. A command absent here keeps the
// generic rule, so `zzz -f/etc/x` still scans.
//
// The model must be POSITIVE: a letter it does not list is not assumed safe. An
// unmodelled letter falls back to the generic fail-closed scan, so a path flag the
// model omits (`gcc -include/etc/x`, `javac -cp/etc/x`) is still scanned instead of
// being dropped with the token.
const ATTACHED_SHORT_MODEL: Record<string, { values: string; path: string }> = {
  awk: { values: "Ffv", path: "f" },
  // `-f` program file and `-i` include file are both local reads.
  gawk: { values: "Ffvi", path: "fi" },
  grep: { values: "efm", path: "f" },
  egrep: { values: "efm", path: "f" },
  fgrep: { values: "efm", path: "f" },
  sed: { values: "ef", path: "f" },
  cut: { values: "dfbc", path: "" },
  sort: { values: "ktoST", path: "oT" },
  tr: { values: "ds", path: "" },
  ls: { values: "d", path: "" },
  // `-I` include dir, `-L` library dir and `-o` output are local paths; `-D`/`-U`
  // macro values are not modelled so they reach the generic scan (fail closed).
  gcc: { values: "ILx", path: "ILo" },
  cc: { values: "ILx", path: "ILo" },
  java: { values: "D", path: "" },
  // `-d` output dir is a path; `-cp`/`-classpath` reach the generic scan.
  javac: { values: "d", path: "d" },
}

// Long options whose `--opt=value` is a pattern or script, not a path. Path-bearing
// long options (`--files-from=`, `--file=`) stay generic.
const ATTACHED_LONG_NOT_PATH: Record<string, Set<string>> = {
  grep: new Set(["--regexp", "--exclude", "--include", "--exclude-dir", "--include-dir"]),
  egrep: new Set(["--regexp", "--exclude", "--include", "--exclude-dir", "--include-dir"]),
  fgrep: new Set(["--regexp", "--exclude", "--include", "--exclude-dir", "--include-dir"]),
  sed: new Set(["--expression"]),
  awk: new Set(["--field-separator"]),
  gawk: new Set(["--field-separator"]),
  java: new Set(["--define"]),
}

// A path attached to an option (`--files-from=/etc/x`, `-T/etc/x`, `tar -cf<path>`)
// starts with `-`, so a plain dash-skip loses it before the scan. Extract the
// path-like remainder so it can be scanned first.
function genericAttached(body: string) {
  const marks = [body.indexOf("/"), body.indexOf("~"), body.indexOf("..")].filter((index) => index !== -1)
  if (marks.length === 0) return
  const at = Math.min(...marks)
  // A value preceded purely by option letters is a path (`-T/etc`, `-cf/out`).
  if ([...body.slice(0, at)].every((char) => /[A-Za-z]/.test(char))) return body.slice(at)
  // An `=`/`,`-attached value can still name a path (`-X=/etc/x`, `-Wl,/etc/x`,
  // `-Wl,-rpath,/etc`). Scan an absolute/traversing tail only, so relative linker
  // paths (`-Wl,-rpath,lib/x`) and macro values (`-Dfoo=bar/baz`) stay quiet.
  const sep = Math.max(body.lastIndexOf("=", at - 1), body.lastIndexOf(",", at - 1))
  if (sep === -1) return
  const value = body.slice(sep + 1)
  if (value.startsWith("/") || value.startsWith("~") || value.includes("..")) return value
  return
}

function attachedOptionValue(text: string, name?: string) {
  if (text.startsWith("--")) {
    const equals = text.indexOf("=")
    if (equals === -1) return
    if (name && ATTACHED_LONG_NOT_PATH[name]?.has(text.slice(0, equals))) return
    return text.slice(equals + 1) || undefined
  }
  const body = text.slice(1)
  const model = name ? ATTACHED_SHORT_MODEL[name] : undefined
  if (model) {
    for (let at = 0; at < body.length; at++) {
      if (!model.values.includes(body[at])) continue
      if (!model.path.includes(body[at])) return
      return body.slice(at + 1) || undefined
    }
    // No modelled value-taking letter: fall back to the generic scan rather than
    // dropping the token, so an unmodelled flag of a modelled command still scans.
    return genericAttached(body)
  }
  return genericAttached(body)
}

// The operands a fail-closed scan must inspect for one token: the token itself plus
// the value of an `if=`/`of=`-style assignment, with attached option paths split out.
function operandTargets(text: string, name?: string) {
  // Quotes hide an option from the `startsWith("-")` test (`gcc "-I/etc"`), so the
  // attached value is extracted from the unquoted token the shell actually runs.
  const bare = unquote(text)
  if (bare.startsWith("-") && bare !== "-") {
    const value = attachedOptionValue(bare, name)
    return value === undefined ? [] : [value]
  }
  const operand = /^[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(bare)
  return operand ? [bare, operand[1]] : [text]
}

// Local-path option positions of a remote CLI. Everything else on those command lines
// (the inner command, container paths, `host:/dir` operands) is resolved elsewhere.
const REMOTE_PATH_CHARS: Record<string, string> = { ssh: "iFoE", kubectl: "f", docker: "fvo", podman: "fvo" }
const REMOTE_PATH_LONG: Record<string, Set<string>> = {
  ssh: new Set(["--identity", "--config"]),
  kubectl: new Set([
    "--filename",
    "--kubeconfig",
    "--from-file",
    "--from-env-file",
    "--certificate-authority",
    "--client-certificate",
    "--client-key",
    "--token-file",
  ]),
  docker: new Set([
    "--file",
    "--volume",
    "--mount",
    "--output",
    "--env-file",
    "--kubeconfig",
    "--security-opt",
    "--device",
    "--iidfile",
    "--build-arg",
    "--input",
    "--secret",
  ]),
  podman: new Set([
    "--file",
    "--volume",
    "--mount",
    "--output",
    "--env-file",
    "--kubeconfig",
    "--security-opt",
    "--device",
    "--iidfile",
    "--build-arg",
    "--input",
    "--secret",
  ]),
}

// Runtime subcommand words. `remotePaths` locates the subcommand by word rather than
// trusting `positionals[0]`: an unmodelled global value-option still pushes its value in
// front, and keying operand rules off the first positional then hides `cp`/`build`.
const REMOTE_SUBCOMMANDS: Record<string, Set<string>> = {
  docker: new Set([
    "run", "create", "exec", "cp", "build", "load", "import", "save", "export", "play",
    "kube", "context", "ps", "start", "stop", "restart", "rm", "rmi", "pull", "push",
    "images", "inspect", "logs", "network", "volume", "compose", "version", "info",
    "container", "image", "system", "attach", "commit", "diff", "events", "history",
    "pause", "unpause", "port", "rename", "stats", "top", "update", "wait", "kill",
    "login", "logout", "search", "tag", "checkpoint", "plugin", "swarm", "trust",
  ]),
  podman: new Set([
    "run", "create", "exec", "cp", "build", "load", "import", "save", "export", "play",
    "kube", "context", "ps", "start", "stop", "restart", "rm", "rmi", "pull", "push",
    "images", "inspect", "logs", "network", "volume", "compose", "version", "info",
    "container", "image", "system", "attach", "commit", "diff", "events", "history",
    "pause", "unpause", "port", "rename", "stats", "top", "update", "wait", "kill",
    "login", "logout", "search", "tag", "healthcheck", "generate", "machine", "manifest",
    "pod", "secret", "untag", "unshare",
  ]),
  kubectl: new Set([
    "get", "apply", "cp", "exec", "logs", "describe", "create", "delete", "replace",
    "patch", "rollout", "scale", "port-forward", "config", "version", "edit", "set",
    "auth", "api-resources", "api-versions", "cluster-info", "cordon", "drain",
    "uncordon", "diff", "explain", "expose", "label", "annotate", "attach", "run",
    "wait", "proxy", "top", "completion", "convert", "kustomize", "debug",
  ]),
}

// Global options that consume the following token as a value. They appear before the
// subcommand, so an unmodelled one would otherwise push its value into `positionals`
// and displace `cp`/`build` (`docker --log-level debug cp …`, `kubectl -n default cp`).
const REMOTE_GLOBAL_CHARS: Record<string, string> = { ssh: "", kubectl: "nsv", docker: "lHc", podman: "lHc" }
const REMOTE_GLOBAL_LONG: Record<string, Set<string>> = {
  ssh: new Set(),
  kubectl: new Set([
    "--namespace",
    "--context",
    "--kubeconfig",
    "--user",
    "--cluster",
    "--server",
    "--token",
    "--certificate-authority",
    "--client-certificate",
    "--client-key",
    "--request-timeout",
    "--as",
    "--as-group",
    "--cache-dir",
    "--tls-server-name",
    "--token-file",
  ]),
  docker: new Set(["--log-level", "--context", "--host", "--config"]),
  podman: new Set([
    "--log-level",
    "--context",
    "--host",
    "--config",
    "--root",
    "--runroot",
    "--runtime",
    "--storage-driver",
    "--url",
    "--identity",
  ]),
}
const VOLUME_LONG = new Set(["--volume", "--mount"])
const VOLUME_CHARS = "v"

// `--from-file key=/etc/x` names the path on the right of a `key=` prefix; a
// `--secret id=x,src=/etc/x` pair list names it after `src=`/`source=`.
function stripKeyPrefix(value: string) {
  const pair = /(?:^|,)(?:src|source)=([^,]+)/i.exec(value)
  if (pair) return pair[1]
  const match = /^[A-Za-z_][A-Za-z0-9_.-]*=(.+)$/.exec(value)
  return match ? match[1] : value
}

// An attached option value names a local file only when it is absolute, home-relative,
// variable-driven or climbs out of the worktree (`/etc/x`, `~/.x`, `$D/x`, `../x`). A
// config word (`debug`, `default`) or a runtime URL (`tcp://…`) names no local file and
// must stay quiet.
function looksPathLike(value: string) {
  return value.startsWith("/") || value.startsWith("~") || value.includes("$") || /(^|[\\/])\.\.([\\/]|$)/.test(value)
}

// A `-v`/`--volume` value is `local[:container[:opts]]`; a `--mount` value is a
// comma-separated pair list where `source`/`src` is the host path.
function mountLocal(value: string) {
  if (/(^|,)(source|src|target|destination|type)=/i.test(value)) {
    return value.split(",").flatMap((pair) => {
      const match = /^(source|src)=(.+)$/i.exec(pair)
      return match ? [match[2]] : []
    })
  }
  const colon = value.indexOf(":")
  return colon === -1 ? [] : [value.slice(0, colon)]
}

function remotePaths(name: string, command: Part[]) {
  const args = command.slice(1)
  const pathChars = REMOTE_PATH_CHARS[name] ?? ""
  const pathLong = REMOTE_PATH_LONG[name] ?? new Set<string>()
  const globalChars = REMOTE_GLOBAL_CHARS[name] ?? ""
  const globalLong = REMOTE_GLOBAL_LONG[name] ?? new Set<string>()
  const subcommands = REMOTE_SUBCOMMANDS[name]
  const out: string[] = []
  // A positional can arrive as the value of an unmodelled global option
  // (`docker --tlscacert ps cp …`). It must still be scanned, but it must never be
  // mistaken for the subcommand.
  const positionals: { text: string; optionValue: boolean }[] = []
  let plain = 0
  let index = 0
  const addValue = (volume: boolean, value: string) => {
    out.push(...(volume ? mountLocal(value) : [stripKeyPrefix(value)]))
  }
  while (index < args.length) {
    // Quotes hide an option from the `startsWith("--")` tests below (`docker "--tlscacert"
    // ps cp …`), which drops the option and its value from the model. Inspect the token
    // the shell actually runs.
    const text = unquote(args[index].text)
    if (text === "--") {
      for (const item of args.slice(index + 1)) {
        positionals.push({ text: item.text, optionValue: false })
        plain++
      }
      break
    }
    if (text.startsWith("--")) {
      const equals = text.indexOf("=")
      if (equals !== -1) {
        const key = text.slice(0, equals)
        const value = text.slice(equals + 1)
        if (pathLong.has(key)) addValue(VOLUME_LONG.has(key), value)
        // `docker --config=<dir>` names a local directory whose `<dir>/config.json` the
        // runtime opens. The space form is a declared residual (it would prompt on the
        // routine `--config ~/.docker`); the attached `=` form is consumed and scanned.
        else if (key === "--config") out.push(stripKeyPrefix(value))
        // An unmodelled `--opt=<value>` global option still carries a local value the
        // runtime may open (`docker --tlscacert=/etc/hostname ps`). Scan a path-like value
        // fail-closed; a config word attaches to no local file and stays quiet.
        else if (plain === 0 && looksPathLike(value)) out.push(stripKeyPrefix(value))
        index++
        continue
      }
      if (pathLong.has(text)) {
        const value = args[index + 1]?.text
        if (value !== undefined) addValue(VOLUME_LONG.has(text), value)
        index += 2
        continue
      }
      // A known global value-option before the subcommand consumes its value.
      if (plain === 0 && globalLong.has(text)) {
        index += 2
        continue
      }
      // An unknown long option in the global region may still consume the next token
      // (`docker --tlscacert ps cp …`). Keep that token in `positionals` so it is
      // scanned, but mark it so `findIndex` cannot lock onto it as the subcommand.
      if (plain === 0) {
        const value = args[index + 1]?.text
        if (value !== undefined && !value.startsWith("-")) {
          positionals.push({ text: value, optionValue: true })
          index += 2
          continue
        }
      }
      index++
      continue
    }
    if (text.startsWith("-") && text !== "-") {
      const body = text.slice(1)
      let consumeNext = false
      for (let at = 0; at < body.length; at++) {
        const flag = body[at]
        if (pathChars.includes(flag)) {
          const attached = body.slice(at + 1)
          if (attached) addValue(VOLUME_CHARS.includes(flag), attached)
          else {
            const value = args[index + 1]?.text
            if (value !== undefined) addValue(VOLUME_CHARS.includes(flag), value)
            consumeNext = true
          }
          break
        }
        if (plain === 0 && globalChars.includes(flag)) {
          if (at === body.length - 1) consumeNext = true
          break
        }
      }
      index += consumeNext ? 2 : 1
      continue
    }
    positionals.push({ text, optionValue: false })
    plain++
    index++
  }
  // Locate the runtime subcommand as a known subcommand word rather than the first
  // positional: an unmodelled global value-option (`docker --tlscacert <f> cp …`) pushes
  // its value in front, and keying the operand rules off `positionals[0]` then missed
  // `cp`/`build` entirely. Option values are not candidates: a CA bundle named `ps` must
  // not displace the real `cp`.
  const subIndex = subcommands
    ? positionals.findIndex((item) => !item.optionValue && subcommands.has(item.text))
    : -1
  const sub = subIndex === -1 ? positionals[0]?.text : positionals[subIndex].text
  // A `container:/path` operand resolves inside the runtime; a bare one is local.
  const local = (operand: string) => !/^[^/\\:]+:/.test(operand)
  // Values of unmodelled global options sit in front of the subcommand. They are local
  // files (a CA bundle, a connection name), not remote operands, so scan them; without
  // this a stored `docker --tlscacert *` grant would absorb the read.
  if (subcommands && subIndex > 0) {
    for (const operand of positionals.slice(0, subIndex)) if (local(operand.text)) out.push(operand.text)
  }
  if (subcommands && subIndex === -1) {
    // No known subcommand word: fail closed and scan every local positional.
    for (const operand of positionals) if (local(operand.text)) out.push(operand.text)
  } else if (sub === "cp") {
    for (const operand of positionals.slice(subIndex + 1)) if (local(operand.text)) out.push(operand.text)
  } else if ((name === "docker" || name === "podman") && sub === "build") {
    const context = positionals[positionals.length - 1]?.text
    if (context !== undefined && context !== sub && context !== ".") out.push(context)
  } else if (sub === "load" || sub === "import") {
    // `load -i FILE` / `import FILE` read a local archive or image.
    for (const operand of positionals.slice(subIndex + 1)) if (local(operand.text)) out.push(operand.text)
  } else if (
    (name === "docker" || name === "podman") &&
    sub === "play" &&
    positionals[subIndex + 1]?.text === "kube"
  ) {
    for (const operand of positionals.slice(subIndex + 2)) if (local(operand.text)) out.push(operand.text)
  } else if (
    (name === "docker" || name === "podman") &&
    sub === "kube" &&
    positionals[subIndex + 1]?.text === "play"
  ) {
    for (const operand of positionals.slice(subIndex + 2)) if (local(operand.text)) out.push(operand.text)
  } else if (
    (name === "docker" || name === "podman") &&
    sub === "context" &&
    positionals[subIndex + 1]?.text === "import"
  ) {
    for (const operand of positionals.slice(subIndex + 3)) if (local(operand.text)) out.push(operand.text)
  }
  return out
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    const name = list[0] ? bareName(commandName(list[0].text)) : undefined
    return list.slice(1).flatMap((item): string[] => {
      const bare = unquote(item.text)
      if (bare.startsWith("-") && bare !== "-") {
        const value = attachedOptionValue(bare, name)
        return value === undefined ? [] : [value]
      }
      if (cmd && bare.startsWith("/")) return []
      if (name === "chmod" && bare.startsWith("+")) return []
      return [item.text]
    })
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("ShellTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan, input: { command: string }) {
  if (scan.dirs.size > 0) {
    const directories = Array.from(scan.dirs)
    const globs = directories.map((dir) => {
      if (process.platform === "win32") return FSUtil.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {
        command: input.command,
        directories,
        patterns: globs,
      },
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {
      command: input.command,
    },
  })
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* FSUtil.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const flags = yield* RuntimeFlags.Service
    const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? 2 * 60 * 1000

    const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return FSUtil.normalizePath(file)
    })

    const resolvePath = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/") && FSUtil.windowsPath(text) === text) {
          const file = yield* cygpath(shell, text)
          if (file) return file
        }
        return FSUtil.normalizePath(path.resolve(root, FSUtil.windowsPath(text)))
      }
      return path.resolve(root, text)
    })

    // Unlike `resolvePath`, this keeps `..` components in the joined path so the later
    // `realpath` follows symlinks before collapsing them (`link/../etc` escapes).
    const rawPath = Effect.fn("ShellTool.rawPath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") return yield* resolvePath(text, root, shell)
      if (path.isAbsolute(text)) return text
      return root + (root.endsWith(path.sep) ? "" : path.sep) + text
    })

    const argPath = Effect.fn("ShellTool.argPath")(function* (
      arg: string,
      cwd: string,
      ps: boolean,
      shell: string,
      vars?: Map<string, string>,
    ) {
      // A word carrying an unresolvable ANSI-C escape still runs as a bash-decoded path.
      // Anchor the scan conservatively instead of letting mangled text look contained.
      if (!ps && arg.includes(UNRESOLVED)) return { external: true as const }
      const text = expand(arg, cwd, shell, vars)
      if (!text) return
      if (!ps && text.includes(UNRESOLVED)) return { external: true as const }
      if (!ps && deviceSink(text)) return
      const file = prefix(text)
      // A glob at position 0 has no literal prefix, but the shell still expands it
      // relative to cwd and it can traverse out of the worktree (`*/../../etc`).
      // Resolve the reachable directory so the external_directory scan still runs.
      if (!file) return yield* rawPath(globAnchor(text), cwd, shell)
      if (!ps) {
        const tilde = expandTilde(file, cwd)
        if (tilde === true) return { external: true as const }
        if (typeof tilde === "string") return yield* rawPath(tilde, cwd, shell)
      }
      if (dynamic(file, ps)) {
        if (unresolvableExternal(file)) return { external: true as const }
        return
      }
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* rawPath(next, cwd, shell)
    })

    const collect = Effect.fn("ShellTool.collect")(function* (
      root: Node,
      cwd: string,
      ps: boolean,
      shell: string,
      instance: InstanceContext,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }
      const shellKind = ShellID.toKind(Shell.name(shell))
      const state = { dynamic: false }
      const pending: { tokens: string[]; dynamic: boolean }[] = []
      // A redirect target built from a variable (`O=/etc/x; cmd > $O`) resolves to empty
      // in `expand` and would silently pass. Carry the assignments so `$NAME` resolves to
      // the value the shell will actually use. They are keyed by source offset so a later
      // reassignment (`strings $O; O=notes.txt`) cannot retroactively rewrite an earlier
      // read, and a for-loop variable is treated like an assignment for its body.
      const assignments: { at: number; name: string; value: string }[] = []
      for (const node of root.descendantsOfType("variable_assignment")) {
        const name = node?.childForFieldName("name")?.text
        const value = node?.childForFieldName("value")?.text
        if (name && value !== undefined) assignments.push({ at: node.startIndex, name, value: unquote(value) })
      }
      for (const node of root.descendantsOfType("for_statement")) {
        const name = node?.childForFieldName("variable")?.text
        const value = node?.childForFieldName("value")?.text
        if (name && value !== undefined) assignments.push({ at: node.startIndex, name, value: unquote(value) })
      }
      const varsAt = (at: number) => {
        const vars = new Map<string, string>()
        for (const item of assignments) if (item.at <= at) vars.set(item.name, item.value)
        return vars
      }

      const addPath = Effect.fnUntraced(function* (resolved: string | { external: true } | undefined) {
        if (!resolved) return false
        // An unresolvable expansion or `~name` leaves the worktree; anchor the scan at
        // the filesystem root so the external_directory prompt still fires.
        if (typeof resolved !== "string") {
          scan.dirs.add(path.parse(cwd).root)
          return true
        }
        // Lexical containment is not enough: a symlink inside the worktree can point
        // outside it. Require both the lexical path and its resolved target.
        const real = FSUtil.resolveExistingFrom(cwd, resolved)
        if (containsPath(resolved, instance) && containsPath(real, instance)) return false
        const dir = (yield* fs.isDir(real)) ? real : path.dirname(real)
        scan.dirs.add(dir)
        return true
      })

      // A `cd`/`pushd`/`popd` whose destination is not a plain literal moves the shell
      // somewhere the scan cannot resolve (`cd $X`, `cd -`, bare `cd`). Treat it as
      // dynamic so the scan anchors at the filesystem root; otherwise a later relative
      // read escapes the worktree with no `external_directory` request.
      const inspectCwd = (name: string | undefined, args: string[]) => {
        if (!name || !CWD.has(name)) return
        const positional = args.filter((item) => !item.startsWith("-"))
        if (positional.length === 0 || positional.some((item) => dynamic(unquote(item), ps))) state.dynamic = true
      }

      // `eval` and `env -S` re-parse their decoded string as a shell command, so its cwd
      // change or file arguments are not visible in the outer token list. Reparse it and
      // classify the nested commands through the same wrapper resolution.
      const classify: (
        command: Part[],
        depth?: number,
        substituted?: boolean,
        vars?: Map<string, string>,
      ) => Effect.Effect<{ name?: string; info: Effective; conservative?: boolean }, never, never> = Effect.fnUntraced(function* (
        command: Part[],
        depth = 0,
        substituted = false,
        vars: Map<string, string> = new Map(),
      ) {
        const info = effective(command)
        const name = shellKind === "cmd" ? info.name?.toLowerCase() : info.name
        // A command name that is itself a shell expansion (`$D $HOME`, `cd${IFS}$HOME`)
        // can be a cwd change or any other command; without knowing which, the safe move
        // is to treat the invocation as dynamic so no later relative read inherits an
        // `always` grant.
        if (info.unresolved || (name !== undefined && dynamic(name, ps))) state.dynamic = true
        inspectCwd(
          name,
          info.command.slice(1).map((item) => item.text),
        )
        if (info.cwdTarget && dynamic(unquote(info.cwdTarget.text), ps)) state.dynamic = true
        if (info.cwdTarget) yield* addPath(yield* argPath(info.cwdTarget.text, cwd, ps, shell, vars))
        if (info.extraPaths?.length) {
          for (const item of info.extraPaths) yield* addPath(yield* argPath(item, cwd, ps, shell, vars))
        }
        let conservative = info.command.some((item) => item.text.includes(UNRESOLVED))
        let external = false
        const reparse: (text: string, base: Map<string, string>) => Effect.Effect<void, never, never> =
          Effect.fnUntraced(function* (text: string, base: Map<string, string>) {
            if (depth >= 8) {
              state.dynamic = true
              scan.dirs.add(path.parse(cwd).root)
              return
            }
            const expanded = expand(text, cwd, shell, base)
            if (!expanded) return
            if (expanded.includes(UNRESOLVED)) {
              state.dynamic = true
              scan.dirs.add(path.parse(cwd).root)
              return
            }
            const exit = yield* parse(expanded, ps).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              state.dynamic = true
              scan.dirs.add(path.parse(cwd).root)
              return
            }
            const tree = exit.value
            // The payload carries its own assignments (`x=/etc/hostname; cat $x`). They
            // shadow the caller's scope for commands after them but must not replace it,
            // so build an offset-keyed view merged over `base`.
            const local: { at: number; name: string; value: string }[] = []
            for (const node of tree.rootNode.descendantsOfType("variable_assignment")) {
              const name = node?.childForFieldName("name")?.text
              const value = node?.childForFieldName("value")?.text
              if (name && value !== undefined) local.push({ at: node.startIndex, name, value: unquote(value) })
            }
            for (const node of tree.rootNode.descendantsOfType("for_statement")) {
              const name = node?.childForFieldName("variable")?.text
              const value = node?.childForFieldName("value")?.text
              if (name && value !== undefined) local.push({ at: node.startIndex, name, value: unquote(value) })
            }
            const scoped = (at: number) => {
              const vars = new Map(base)
              for (const item of local) if (item.at <= at) vars.set(item.name, item.value)
              return vars
            }
            for (const node of commands(tree.rootNode)) {
              const nested = parts(node)
              // A bare `$(...)` parses as a command whose name is the substitution itself;
              // its real program is the descendant command, which `commands` also returns.
              if (nested.length === 0 || dynamic(unquote(nested[0].text), ps)) continue
              const scope = scoped(inFunction(node) ? Number.MAX_SAFE_INTEGER : node.startIndex)
              const result = yield* classify(nested, depth + 1, true, scope)
              if (result.conservative) conservative = true
            }
            // Redirect destinations inside the re-parsed payload (`echo 'true > /tmp/out'`)
            // only exist in this subtree; the outer redirect loop never sees them.
            for (const redirect of tree.rootNode.descendantsOfType("file_redirect")) {
              if (!redirect) continue
              const destination = redirect.childForFieldName("destination")
              if (!destination) continue
              const target = destination.text
              const scope = scoped(inFunction(redirect) ? Number.MAX_SAFE_INTEGER : redirect.startIndex)
              if (yield* addPath(yield* argPath(target, cwd, ps, shell, scope))) {
                external = true
                continue
              }
              if (target.includes("$(") || target.includes("`")) yield* reparse(target, scope)
            }
            tree.delete()
          })
        const scanTarget = Effect.fnUntraced(function* (target: string) {
          const expanded = expand(target, cwd, shell, vars)
          // Inside an extracted shell string a `$(...)` result is program text, not a
          // filename: a payload quoted into one word must be re-parsed as a command line
          // or `sh -c "$(echo 'cat /etc/hostname')"` reads the file unscanned. A bare path
          // stays a path so `O=$(echo /etc/x); cat $O` is still scanned by the operand path.
          if (
            substituted &&
            expanded &&
            !expanded.includes(UNRESOLVED) &&
            !expanded.startsWith("-") &&
            looksLikeCommandLine(expanded)
          ) {
            yield* reparse(expanded, vars)
            return
          }
          const resolved = yield* argPath(target, cwd, ps, shell, vars)
          if (yield* addPath(resolved)) external = true
          if (resolved !== undefined) return
          // A variable assigned a command substitution (`O=$(echo /etc/x); cat $O`)
          // executes it even though `argPath` cannot resolve the result.
          if (target.includes("$") && expanded && (expanded.includes("$(") || expanded.includes("`"))) {
            yield* reparse(expanded, vars)
          }
        })
        const scanOperands = Effect.fnUntraced(function* () {
          for (const item of info.command.slice(1)) {
            for (const target of operandTargets(item.text, name)) yield* scanTarget(target)
          }
        })
        if (name && (FILES.has(name) || (shellKind === "cmd" && CMD_FILES.has(name)))) {
          for (const arg of pathArgs(info.command, ps, shellKind === "cmd")) yield* scanTarget(arg)
        } else if (info.unresolved) {
          // The wrapper could not be resolved, so the real command is somewhere in the
          // argument list. Scan every token for an external path rather than trust the
          // wrapper name.
          yield* scanOperands()
        } else if (name && DATA.has(name) && !substituted) {
          // Arguments are broadcast as text (`echo cat /etc/hostname`), never opened. A
          // command synthesised from a `$(...)` in an extracted shell string is different:
          // there `echo`'s arguments are the program that will run.
        } else if (name && REMOTE.has(name)) {
          // The inner command runs on another host or inside a container, but a bind
          // mount, copy operand or key/config file is still a local path.
          for (const target of remotePaths(name, info.command)) {
            if (yield* addPath(yield* argPath(target, cwd, ps, shell, vars))) external = true
          }
          conservative = conservative || external
        } else {
          // Any command the classifier cannot model fails closed. Scan every operand —
          // including an attached option value or an `if=`/`of=` style operand — and
          // withdraw `always` when an external path is present, so neither the offered
          // grant nor a stored `<cmd> *` rule can absorb a future external effect. This
          // is the class close for read-capable commands that are not in `FILES`.
          yield* scanOperands()
          conservative = conservative || external
        }
        if (info.evalScript && depth < 8) {
          // The string is program text. Expand it only when it names a variable the
          // assignment model resolved, so a variable holding program text
          // (`C='cat /etc/hostname'; bash -c "$C"`) becomes the command the shell runs.
          // An unassigned `$HOME`/`$VAR` is left intact so the cwd/`dynamic` handling
          // (`eval "cd $HOME"`) still sees it as dynamic instead of a literal path.
          // A `${…:-word}`/`${…:+word}` default is resolved even without a known variable:
          // `expand` substitutes the word, so `bash -c "${X:-cat notes.txt}"` stays an
          // in-tree read rather than a literal script the fail-closed anchor would prompt.
          const defaulted = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-|:=|-|:\+)/.test(info.evalScript)
          const known =
            defaulted ||
            [...info.evalScript.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].some((match) => vars.has(match[1]))
          const script = known ? expand(info.evalScript, cwd, shell, vars) : info.evalScript
          if (script.includes(UNRESOLVED)) {
            state.dynamic = true
            scan.dirs.add(path.parse(cwd).root)
          }
          // A `$(...)`/backtick inside the extracted string is not data: the substitution
          // result is what the shell executes, so its content must never hit `DATA`.
          const nestedSubstituted = substituted || script.includes("$(") || script.includes("`")
          const exit = yield* parse(script, ps).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) {
            const tree = exit.value
            const nested = commands(tree.rootNode)
            // The payload carries its own assignments (`C='x=/etc/hostname; cat $x'`); they
            // are live for the commands that follow them, so build the same offset-keyed
            // view `reparse` uses, merged over the caller's scope.
            const local: { at: number; name: string; value: string }[] = []
            for (const node of tree.rootNode.descendantsOfType("variable_assignment")) {
              const name = node?.childForFieldName("name")?.text
              const value = node?.childForFieldName("value")?.text
              if (name && value !== undefined) local.push({ at: node.startIndex, name, value: unquote(value) })
            }
            for (const node of tree.rootNode.descendantsOfType("for_statement")) {
              const name = node?.childForFieldName("variable")?.text
              const value = node?.childForFieldName("value")?.text
              if (name && value !== undefined) local.push({ at: node.startIndex, name, value: unquote(value) })
            }
            const scoped = (at: number) => {
              const merged = new Map(vars)
              for (const item of local) if (item.at <= at) merged.set(item.name, item.value)
              return merged
            }
            let classified = 0
            let rejected = false
            for (const node of nested) {
              const item = parts(node)
              // A bare `$(...)` string parses as a command named by the substitution; its
              // program is the descendant command, so skip the wrapper to avoid a false root anchor.
              if (item.length === 0) continue
              const head = unquote(item[0].text)
              if (head.startsWith("$(") || head.startsWith("`")) continue
              // A command name the classifier cannot resolve (`$Q cat …`) is still executed
              // by the shell. Dropping it silently loses the program text, so remember it:
              // the anchor below must fire even when a sibling command classifies.
              if (dynamic(head, ps)) {
                rejected = true
                continue
              }
              classified++
              const scope = scoped(inFunction(node) ? Number.MAX_SAFE_INTEGER : node.startIndex)
              const result = yield* classify(item, depth + 1, nestedSubstituted, scope)
              if (result.conservative) conservative = true
            }
            // Any command rejected by `dynamic()` (an unassigned `$Q` prefix, or an
            // unresolvable `${X:-…}` default), or an entirely unclassifiable script: the
            // shell still runs that program text, so fail closed rather than drop it
            // unscanned with no anchor.
            if ((classified === 0 || rejected) && script.trim().length > 0) {
              state.dynamic = true
              scan.dirs.add(path.parse(cwd).root)
            }
            tree.delete()
          } else {
            state.dynamic = true
            scan.dirs.add(path.parse(cwd).root)
          }
        }
        return { name, info, conservative }
      })

      const entries = commands(root).map((node) => {
        const command = parts(node)
        return { node, command, tokens: command.map((item) => item.text) }
      })

      // Redirection targets (`cat < /etc/hostname`, `cmd > /tmp/out`) are dropped from
      // the token list, so a stored grant could absorb that read or write; scan each
      // target path through the same resolution as other arguments.
      for (const redirect of root.descendantsOfType("file_redirect")) {
        if (!redirect) continue
        const destination = redirect.childForFieldName("destination")
        if (!destination) continue
        const text = destination.text
        const vars = varsAt(inFunction(redirect) ? Number.MAX_SAFE_INTEGER : redirect.startIndex)
        const resolved = yield* argPath(text, cwd, ps, shell, vars)
        yield* addPath(resolved)
        if (resolved !== undefined || ps) continue
        if (!text.includes("$") && !text.includes("`")) continue
        if (text.includes("$(") || text.includes("`")) {
          // `cmd > $(...)` executes the substitution; classify its content so the
          // target is not silently treated as text.
          const exit = yield* parse(text, ps).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) {
            const tree = exit.value
            for (const node of commands(tree.rootNode)) {
              const nested = parts(node)
              if (nested.length === 0 || dynamic(unquote(nested[0].text), ps)) continue
              yield* classify(nested, 0, true, vars)
            }
            tree.delete()
          } else {
            scan.dirs.add(path.parse(cwd).root)
          }
          continue
        }
        // Shell-generated numeric variables (`$$`, `$RANDOM`) cannot introduce an
        // absolute path, so `out-$$.log` stays a relative target in cwd. Only a variable
        // the classifier cannot account for anchors at the root.
        if (!text.replace(RELATIVE_VAR, "0").includes("$")) continue
        scan.dirs.add(path.parse(cwd).root)
      }

      // A non-empty command the parser could not turn into a `command` node (a bare
      // brace list, any future parse blind spot) must not run unprompted. Anchor the
      // scan at the filesystem root and prompt; `always` stays empty.
      if (entries.length === 0 && !ps && root.hasError && root.text.trim().length > 0) {
        scan.dirs.add(path.parse(cwd).root)
        scan.patterns.add(root.text.trim())
        return scan
      }

      // Classify every command before deciding the always-grant, so a dynamic `cd`
      // anywhere in the invocation (including through a wrapper or `eval`) suppresses
      // it for all of them, not just commands that happen to parse after it.
      const resolved: { name?: string; info: Effective; conservative?: boolean }[] = []
      for (const entry of entries) {
        const scope = varsAt(inFunction(entry.node) ? Number.MAX_SAFE_INTEGER : entry.node.startIndex)
        resolved.push(yield* classify(entry.command, 0, false, scope))
      }

      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]
        const result = resolved[index]
        if (!result || entry.tokens.length === 0) continue
        if (result.name && CWD.has(result.name)) continue
        scan.patterns.add(source(entry.node))
        // A command whose arguments contain a shell expansion cannot be captured by a
        // literal `prefix *` grant: the expansion (a variable path, a command
        // substitution) can resolve to a different path or flag on every run. A wrapper
        // moves the effective command off the raw token, so its `prefix *` pattern would
        // absorb a future unrelated invocation. Offer only a one-shot prompt for both.
        pending.push({
          tokens: entry.tokens,
          dynamic:
            entry.command.some((item) => dynamic(item.text, ps)) ||
            result.info.wrapped === true ||
            result.info.unresolved === true ||
            result.conservative === true ||
            (result.info.extraPaths?.length ?? 0) > 0 ||
            /[\\/]/.test(entry.tokens[0] ?? ""),
        })
      }

      if (state.dynamic) scan.dirs.add(path.parse(cwd).root)
      for (const item of pending) {
        if (state.dynamic || item.dynamic) continue
        scan.always.add(BashArity.prefix(item.tokens).join(" ") + " *")
      }

      return scan
    })

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const sanitized = sanitizePluginEnv(extra.env)
      if (sanitized.dropped.length > 0)
        yield* Effect.logWarning("dropped plugin shell.env variables not on the allowlist", {
          keys: sanitized.dropped,
        })
      return {
        ...process.env,
        ...sanitized.env,
      }
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let fullBytes = 0
      const tailChunks: string[] = []
      let tailLength = 0
      let tailTrimmed = false
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false
      let lastMetadataFlush = 0
      let metadataDirty = false

      const appendTail = (chunk: string) => {
        tailChunks.push(chunk)
        tailLength += chunk.length
        if (tailLength > MAX_METADATA_LENGTH) {
          const sliced = tailChunks.join("").slice(-MAX_METADATA_LENGTH)
          tailChunks.length = 0
          tailChunks.push(sliced)
          tailLength = sliced.length
          tailTrimmed = true
        }
      }
      const tailPreview = () => (tailTrimmed ? "...\n\n" : "") + tailChunks.join("")

      const closeSink = Effect.fnUntraced(function* () {
        const stream = sink
        if (!stream) return
        sink = undefined
        if (stream.destroyed || stream.closed) return
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                stream.off("close", done)
                stream.off("error", done)
                stream.off("finish", done)
                resolve()
              }
              stream.once("close", done)
              stream.once("error", done)
              stream.once("finish", done)
              stream.end(done)
            }),
        ).pipe(Effect.catch(() => Effect.void))
      })

      yield* ctx.metadata({
        metadata: {
          output: "",
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(closeSink)
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size })
              used += size
              while (used > keep && list.length > 1) {
                const item = list.shift()
                if (!item) break
                used -= item.size
                cut = true
              }

              appendTail(chunk)

              if (file) {
                sink?.write(chunk)
              } else {
                full += chunk
                fullBytes += size
                if (fullBytes > limits.maxBytes) {
                  return trunc.write(full).pipe(
                    Effect.andThen((next) =>
                      Effect.sync(() => {
                        file = next
                        cut = true
                        sink = createWriteStream(next, { flags: "a" })
                        full = ""
                        fullBytes = 0
                      }),
                    ),
                    Effect.andThen(
                      ctx.metadata({
                        metadata: {
                          output: tailPreview(),
                        },
                      }),
                    ),
                  )
                }
              }

              const now = Date.now()
              if (now - lastMetadataFlush < METADATA_THROTTLE_MS) {
                metadataDirty = true
                return Effect.void
              }
              lastMetadataFlush = now
              metadataDirty = false
              return ctx.metadata({
                metadata: {
                  output: tailPreview(),
                },
              })
            }),
          )

          // Publish the latest throttled preview once output goes idle, so a command
          // that emits everything then waits does not leave stale running metadata.
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              if (!metadataDirty) return
              metadataDirty = false
              lastMetadataFlush = Date.now()
              yield* ctx.metadata({ metadata: { output: tailPreview() } })
            }).pipe(Effect.repeat(Schedule.spaced(`${METADATA_THROTTLE_MS} millis`))),
          )

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          const timeout = Effect.sleep(`${input.timeout + 100} millis`)

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      if (metadataDirty) {
        metadataDirty = false
        yield* ctx.metadata({
          metadata: {
            output: tailPreview(),
          },
        })
      }

      const meta: string[] = []
      if (expired) {
        meta.push(
          `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      return {
        title: input.command,
        metadata: {
          output: tailPreview() || preview(output),
          exit: code,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        const prompt = ShellPrompt.render(name, process.platform, limits, defaultTimeoutMs)
        yield* Effect.logInfo("shell tool using shell", { shell })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const instanceCtx = yield* InstanceState.context
              const cwd = params.workdir
                ? process.platform === "win32"
                  ? FSUtil.resolveExisting(yield* resolvePath(params.workdir, instanceCtx.directory, shell))
                  : FSUtil.resolveExistingFrom(instanceCtx.directory, params.workdir)
                : instanceCtx.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = params.timeout ?? defaultTimeoutMs
              const ps = Shell.ps(shell)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const braces = flattenBraces(stripLineContinuations(params.command))
                  const tree = yield* Effect.acquireRelease(parse(braces.text, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell, instanceCtx)
                  if (braces.found) scan.always.clear()
                  if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan, params)
                }),
              )

              return yield* run(
                {
                  shell,
                  command: params.command,
                  cwd,
                  env: yield* shellEnv(ctx, cwd),
                  timeout,
                },
                ctx,
              )
            }),
        }
      })
  }),
)

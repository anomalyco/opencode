export * as Wildcard from "./wildcard"

// Compiled patterns never carry the g or y flag, so the cached regex keeps no lastIndex state.
const compiled = new Map<string, RegExp>()

// A shell removes quoting and backslash escapes before it executes a command, so
// `rm "-rf" /`, `rm '-rf' /`, `rm \-rf /` and `ca"t" /etc` all run their unquoted
// form. Strip the quoting the shell would strip *before* matching, otherwise the
// strict argument check can be defeated by wrapping a flag (or a whole command
// name) in quotes.
//
// Quoting is removed position-free: `cat""` and `"cat"` both canonicalize to
// `cat`, so the matcher and the shell agree on the effective command. On unix the
// shell drops the backslash before the next character (`\.` is `.`, `\/` is `/`),
// so all escapes are removed. A Windows path separator is followed by a
// drive/name character (`C:\Windows`), so on win32 a backslash is only unescaped
// when it escapes a shell-special character that could hide a flag or quote; the
// separator is preserved and normalized by `glob`/the caller afterwards.
const SHELL_ESCAPES = new Set(["-", '"', "'", "`", "$", " ", "\\", "(", ")"])

export function unquote(value: string) {
  let out = ""
  let quote: "'" | '"' | undefined
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    // Bash deletes `\<newline>` line continuations before execution (`ca\<newline>t`
    // runs `cat`); single quotes keep the backslash, so exclude only those.
    if (char === "\\" && quote !== "'") {
      const next = value[index + 1]
      if (next === "\n") {
        index++
        continue
      }
      if (next === "\r" && value[index + 2] === "\n") {
        index += 2
        continue
      }
    }
    if (quote) {
      if (char === quote) {
        quote = undefined
        continue
      }
      out += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "\\" && index + 1 < value.length) {
      const next = value[index + 1]
      if (process.platform !== "win32" || SHELL_ESCAPES.has(next)) {
        out += next
        index++
        continue
      }
    }
    out += char
  }
  return out
}

function glob(pattern: string, strict: boolean) {
  const cacheKey = (strict ? "strict:" : "glob:") + pattern
  const cached = compiled.get(cacheKey)
  if (cached) return cached
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  // The strict group refuses a flag in any argument position *and* refuses an
  // argument that still contains a shell expansion after unquoting. `cat $FILE`
  // executes against a path the matcher never saw, and `$(echo -rf) /` can expand
  // to flags, so neither may inherit a saved `cat *` grant. Pathname globs
  // (`*`, `?`, `[`) are expansions too: `cat */../../etc/passwd` must not match a
  // saved literal grant as if the glob were an ordinary argument.
  if (escaped.endsWith(" .*"))
    escaped = escaped.slice(0, -3) + (strict ? "( (?!-)[^\\s$`(){}*?\\[\\]]*)*" : "( .*)?")

  const expression = new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s")
  if (compiled.size >= 512) {
    const oldest = compiled.keys().next()
    if (!oldest.done) compiled.delete(oldest.value)
  }
  compiled.set(cacheKey, expression)
  return expression
}

export function match(input: string, pattern: string) {
  return glob(pattern, false).test(input.replaceAll("\\", "/"))
}

// A shell expands a leading `~name` (and `~+`/`~-`) to a home directory the matcher
// never sees, and follows a `..` component across a symlink before collapsing it, so
// `link/../etc` reads outside while its lexical form looks contained. A persisted
// literal `cmd *` grant must not auto-approve either shape.
const TILDE_EXPANSION = /(^|[\s"'`=])~[^/\\]/
const TRAVERSAL = /(^|[\s"'`/\\:])\.\.($|[/\\])/

/**
 * Like `match`, but the optional trailing argument group of a `"cmd *"`
 * pattern will not match an argument that starts with `-` (in any position) or
 * that still contains a shell expansion (`$`, backtick, parentheses, braces).
 * A user grant persisted as `rm *` must not silently auto-approve `rm -rf /`,
 * `rm x -rf /`, `rm "-rf" /`, or `cat $FILE`; a fresh prompt is required for
 * flag-bearing or expansion-bearing invocations.
 */
export function matchStrict(input: string, pattern: string) {
  // Shell grants are stored as `"<literal prefix> *"` and must be unquoted so a
  // quoted flag (`rm "-rf" /`) cannot masquerade as a literal argument. File-path
  // patterns (external_directory globs, read/write paths) are not shell text, so
  // match them verbatim — unquoting could collapse distinct filenames.
  const shell = pattern.endsWith(" *")
  const value = (shell ? unquote(input) : input).replaceAll("\\", "/")
  if (shell && (TILDE_EXPANSION.test(value) || TRAVERSAL.test(value))) return false
  return glob(shell ? unquote(pattern) : pattern, true).test(value)
}

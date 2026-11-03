import { type AstNode, PendingThrow } from "../interpreter/model.js"

export type Token = AstNode & { text: string }

export function fail(site: Token, message: string, kind: "ParseError" | "UnsupportedSyntax" = "ParseError"): never {
  throw new PendingThrow("SyntaxError", message, site, kind)
}

// Indentation is significant only on nonempty logical lines outside brackets.
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const indents = [0]
  const brackets: string[] = []
  const pattern =
    /[ \t]+|#.*|[fF]["']|[A-Za-z_][A-Za-z_0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|==|!=|<=|>=|\/\/|\*\*|\+=|-=|\*=|[()[\]{}:,.+*/%<>=-]/gy
  let line = 1
  let offset = 0
  const token = (type: string, text: string, column: number): Token => ({
    type,
    text,
    start: offset + column,
    end: offset + column + text.length,
    loc: { start: { line, column }, end: { line, column: column + text.length } },
  })
  if (source.length > 65_536) fail(token("eof", "", 0), "Python programs are limited to 65536 characters.")
  for (const raw of source.split("\n")) {
    const row = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    let at = 0
    if (!/^\s*(?:#.*)?$/.test(row)) {
      if (!brackets.length) {
        at = row.match(/^ */)![0].length
        if (row[at] === "\t") fail(token("indent", "", at), "Use spaces for indentation.")
        if (at > indents.at(-1)!) {
          indents.push(at)
          tokens.push(token("indent", "", at))
        } else {
          while (at < indents.at(-1)!) {
            indents.pop()
            tokens.push(token("dedent", "", at))
          }
          if (at !== indents.at(-1)) fail(token("indent", "", at), "Inconsistent indentation.")
        }
      }
      // Replacement fields use the ordinary expression tokens, with their own bracket stack.
      // Never reparse a cooked string: escaped braces must not become executable fields.
      function lex(stack: string[], field = false) {
        pattern.lastIndex = at
        const text = pattern.exec(row)?.[0]
        if (!text) fail(token("invalid", row[at]!, at), `Unexpected ${JSON.stringify(row[at])}.`)
        const start = at
        at += text.length
        if (text.startsWith("#")) {
          if (field) fail(token("invalid", text, start), "Comments in f-string fields are not supported.")
          at = row.length
          return
        }
        if (/^\s/.test(text)) return
        if (/^[fF]["']$/.test(text)) {
          if (field) fail(token("invalid", text, start), "Nested f-strings are not supported.", "UnsupportedSyntax")
          return formatted(text, start)
        }
        const type = /^[a-z_]/i.test(text)
          ? "name"
          : /^(?:\d|\.\d)/.test(text)
            ? "number"
            : /^["']/.test(text)
              ? "string"
              : "operator"
        const item = token(type, text, start)
        tokens.push(item)
        if (["(", "[", "{"].includes(text)) stack.push(text === "(" ? ")" : text === "[" ? "]" : "}")
        if ([")", "]", "}"].includes(text) && stack.pop() !== text) fail(item, `Unexpected '${text}'.`)
      }
      function formatted(text: string, start: number): void {
        tokens.push(token("fstart", text, start))
        let from = at
        while (at < row.length) {
          const c = row[at]
          if (c === "\\" || ((c === "{" || c === "}") && row[at + 1] === c)) {
            at += 2
            continue
          }
          if (c !== text[1] && c !== "{" && c !== "}") {
            at++
            continue
          }
          if (from < at) tokens.push(token("ftext", row.slice(from, at), from))
          if (c === text[1]) {
            tokens.push(token("fend", c, at++))
            return
          }
          if (c === "}") fail(token("invalid", c, at), "Unmatched '}' in f-string.")
          tokens.push(token("field", "{", at++))
          const nested: string[] = []
          while (at < row.length && (nested.length || row[at] !== "}")) lex(nested, true)
          if (row[at] !== "}") fail(token("invalid", "", at), "Unclosed f-string field.")
          tokens.push(token("endfield", "}", at++))
          from = at
        }
        fail(token("invalid", text, start), "Unclosed f-string.")
      }
      while (at < row.length) lex(brackets)
      if (!brackets.length) tokens.push(token("newline", "", row.length))
    }
    line++
    offset += raw.length + 1
  }
  const eof = token("eof", "", 0)
  if (brackets.length) fail(eof, `Expected '${brackets.at(-1)}'.`)
  for (let i = 1; i < indents.length; i++) tokens.push(token("dedent", "", 0))
  return [...tokens, eof]
}

export function stringLiteral(site: Token): string {
  const raw = site.type === "ftext" ? site.text.replaceAll("{{", "{").replaceAll("}}", "}") : site.text.slice(1, -1)
  return raw.replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|.)/g, (_, escape: string) => {
    if (escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16))
    if (escape === "n") return "\n"
    if (escape === "t") return "\t"
    if (escape === "r") return "\r"
    if (`\\'"`.includes(escape)) return escape
    return fail(site, `Unsupported escape \\${escape}.`, "UnsupportedSyntax")
  })
}

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
    /[ \t]+|#.*|[A-Za-z_][A-Za-z_0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|==|!=|<=|>=|\/\/|\*\*|\+=|-=|\*=|[()[\]{}:,.+*/%<>=-]/gy
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
      while (at < row.length) {
        pattern.lastIndex = at
        const text = pattern.exec(row)?.[0]
        if (!text) fail(token("invalid", row[at]!, at), `Unexpected ${JSON.stringify(row[at])}.`)
        const start = at
        at += text.length
        if (text.startsWith("#")) break
        if (/^\s/.test(text)) continue
        const type = /^[a-z_]/i.test(text)
          ? "name"
          : /^(?:\d|\.\d)/.test(text)
            ? "number"
            : /^["']/.test(text)
              ? "string"
              : "operator"
        const item = token(type, text, start)
        tokens.push(item)
        if (["(", "[", "{"].includes(text)) brackets.push(text === "(" ? ")" : text === "[" ? "]" : "}")
        if ([")", "]", "}"].includes(text) && brackets.pop() !== text) fail(item, `Unexpected '${text}'.`)
      }
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
  return site.text.slice(1, -1).replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|.)/g, (_, escape: string) => {
    if (escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16))
    if (escape === "n") return "\n"
    if (escape === "t") return "\t"
    if (escape === "r") return "\r"
    if (`\\'"`.includes(escape)) return escape
    return fail(site, `Unsupported escape \\${escape}.`, "UnsupportedSyntax")
  })
}

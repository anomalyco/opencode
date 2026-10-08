/** One step of a parsed locator. Each step after the first searches inside the elements the previous step matched. */
export type Step =
  | { readonly kind: "ref"; readonly ref: string }
  | { readonly kind: "css"; readonly selector: string }
  | { readonly kind: "xpath"; readonly expression: string }
  | { readonly kind: "text"; readonly text: string; readonly exact: boolean }
  | { readonly kind: "role"; readonly role: string; readonly name?: string; readonly exact: boolean }
  | { readonly kind: "label"; readonly text: string; readonly exact: boolean }
  | { readonly kind: "placeholder"; readonly text: string; readonly exact: boolean }
  | { readonly kind: "testid"; readonly id: string }
  | { readonly kind: "nth"; readonly index: number }

const ENGINES = ["css", "xpath", "text", "role", "label", "placeholder", "testid", "nth"] as const

type Engine = (typeof ENGINES)[number]

const REF = /^@?e[1-9][0-9]*$/

const EXPLICIT =
  /^(?:(?:css|xpath|text|role|label|placeholder|testid|nth)\s*=|@?e[1-9][0-9]*(?:\s*>>|$)|["']|\/\/|\.\.|\(\/\/)/i

const SYNTAX =
  'Locator syntax: a ref "@e12"; CSS such as "#save" (the default); "text=Save" (substring, any case) or "text=\\"Save\\"" (exact); "role=button[name=\\"Send\\"]"; "label=Email"; "placeholder=Search"; "testid=submit"; "xpath=//main//a". Chain steps with " >> " and pick one match with " >> nth=0" (-1 is the last).'

/**
 * Parse a locator such as `#form >> role=button[name="Send"] >> nth=0` into steps.
 * A ref (`@e12` or `e12`) is valid only as the first step and is returned without its `@`.
 * Throws an Error whose message teaches the grammar when the syntax is invalid.
 */
export function parseLocator(input: string): readonly Step[] {
  if (!input.trim()) throw new Error(`The locator is empty. ${SYNTAX}`)

  return split(input).map((part, index) => step(part, index, input))
}

/** Whether a string is a locator with an explicit engine (css=, text=, role=, …, @eN) rather than plain text. */
export function isExplicitLocator(input: string): boolean {
  return EXPLICIT.test(input.trim()) || input.includes(">>")
}

// Splits on ">>" outside quotes, brackets, and parentheses. An unquoted text value runs to the next ">>",
// so quotes and brackets inside it ("text=Don't save") are part of the text, as in Playwright.
function split(input: string) {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let index = 0

  while (index < input.length) {
    const free = index === start && /^\s*(?:text|label|placeholder|testid)\s*=\s*(?=[^\s"'])/i.exec(input.slice(start))

    if (free) {
      const end = input.indexOf(">>", start + free[0].length)

      if (end < 0) break
      parts.push(input.slice(start, end))
      index = end + 2
      start = index
      continue
    }

    const char = input[index]

    if (char === '"' || char === "'") {
      index = closing(input, index) + 1
      continue
    }

    if (char === "[" || char === "(") depth++

    if ((char === "]" || char === ")") && depth > 0) depth--

    if (depth === 0 && input.startsWith(">>", index)) {
      parts.push(input.slice(start, index))
      index += 2
      start = index
      continue
    }

    index++
  }

  parts.push(input.slice(start))

  return parts
}

function step(raw: string, index: number, input: string): Step {
  const part = raw.trim()

  if (!part)
    throw new Error(
      `The locator ${JSON.stringify(input)} has an empty step; " >> " needs a step on both sides. ${SYNTAX}`,
    )

  if (REF.test(part)) {
    if (index > 0) throw new Error(`The ref "${part}" must be the first step of a locator, as in "@e12 >> text=Save".`)

    return { kind: "ref", ref: part.replace(/^@/, "") }
  }

  const prefix = /^([a-z][\w-]*)\s*=/i.exec(part)

  if (prefix) return engine(prefix[1].toLowerCase(), part.slice(prefix[0].length).trim())

  if (part.startsWith('"') || part.startsWith("'")) return { kind: "text", ...value("text", part) }

  if (/^(?:\/\/|\.\.|\(\/\/)/.test(part)) return { kind: "xpath", expression: part }

  return { kind: "css", selector: part }
}

function engine(name: string, body: string): Step {
  if (!isEngine(name))
    throw new Error(
      `Unknown locator engine "${name}=". Use css=, xpath=, text=, role=, label=, placeholder=, testid=, or nth=, or write CSS without a prefix. ${SYNTAX}`,
    )

  switch (name) {
    case "css":
      if (!body) throw new Error('css= needs a selector, for example css=#save or css="form button.primary".')

      return { kind: "css", selector: body }
    case "xpath":
      if (!body) throw new Error("xpath= needs an expression, for example xpath=//main//a.")

      return { kind: "xpath", expression: body }
    case "text":
      return { kind: "text", ...value(name, body) }
    case "label":
      return { kind: "label", ...value(name, body) }
    case "placeholder":
      return { kind: "placeholder", ...value(name, body) }
    case "testid":
      return { kind: "testid", id: value(name, body).text }
    case "nth":
      if (!/^-?\d+$/.test(body))
        throw new Error(
          `nth= takes an integer index: nth=0 is the first match, nth=1 the second, nth=-1 the last. Got ${JSON.stringify(body)}.`,
        )

      return { kind: "nth", index: Number(body) }
    case "role":
      return role(body)
  }
}

function isEngine(name: string): name is Engine {
  return ENGINES.some((engine) => engine === name)
}

function value(engine: string, body: string) {
  if (!body)
    throw new Error(`${engine}= needs a value, for example ${engine}=Save, or ${engine}="Save" for an exact match.`)

  if (!body.startsWith('"') && !body.startsWith("'")) return { text: body, exact: false }

  const parsed = quoted(body)

  if (parsed.rest.trim())
    throw new Error(
      `Unexpected ${JSON.stringify(parsed.rest.trim())} after the closing quote in ${engine}=${body}. Escape quotes inside a quoted value with a backslash.`,
    )

  if (!parsed.text.trim()) throw new Error(`${engine}= needs a value, for example ${engine}="Save".`)

  return { text: parsed.text, exact: true }
}

function role(body: string): Step {
  const head = /^[a-z][\w-]*/i.exec(body)

  if (!head)
    throw new Error('role= needs an ARIA role, for example role=button, role=heading, or role=button[name="Send"].')

  const parsed = attributes(body.slice(head[0].length).trim(), body)
  const role = head[0].toLowerCase()

  return parsed ? { kind: "role", role, name: parsed.text, exact: parsed.exact } : { kind: "role", role, exact: false }
}

// Parses `[name=…]` groups after a role; the last group wins.
function attributes(rest: string, body: string): { readonly text: string; readonly exact: boolean } | undefined {
  if (!rest) return undefined

  const key = /^\[\s*([\w-]*)\s*/.exec(rest)

  if (!key)
    throw new Error(
      `Unexpected ${JSON.stringify(rest)} in role=${body}. Write role=button or role=button[name="Send"].`,
    )

  if (key[1].toLowerCase() !== "name")
    throw new Error(
      `role= does not support the [${key[1]}] attribute. Supported: name, as in role=button[name="Send"] (exact) or role=button[name=Send] (substring, any case).`,
    )

  const assignment = rest.slice(key[0].length)

  if (!assignment.startsWith("="))
    throw new Error(`[name] needs a value in role=${body}, as in role=button[name="Send"].`)

  const raw = assignment.slice(1).trimStart()

  if (raw.startsWith('"') || raw.startsWith("'")) {
    const parsed = quoted(raw)
    const tail = /^\s*([is])?\s*\]/i.exec(parsed.rest)

    if (!tail) throw new Error(`Expected "]" after the quoted name in role=${body}.`)
    const next = attributes(parsed.rest.slice(tail[0].length).trim(), body)

    return next ?? { text: parsed.text, exact: tail[1]?.toLowerCase() !== "i" }
  }

  const close = raw.indexOf("]")

  if (close < 0) throw new Error(`Missing "]" in role=${body}.`)

  const text = raw.slice(0, close).trim()

  if (!text) throw new Error(`[name] needs a value in role=${body}, as in role=button[name=Send].`)

  return attributes(raw.slice(close + 1).trim(), body) ?? { text, exact: false }
}

// `value` starts with a quote. Backslash escapes the next character.
function quoted(value: string) {
  const end = closing(value, 0)

  return { text: value.slice(1, end).replace(/\\(.)/gs, "$1"), rest: value.slice(end + 1) }
}

function closing(input: string, open: number) {
  const quote = input[open]

  for (let index = open + 1; index < input.length; index++) {
    if (input[index] === "\\") {
      index++
      continue
    }

    if (input[index] === quote) return index
  }

  throw new Error(
    `Unterminated ${quote} quote in the locator ${JSON.stringify(input)}. Close the quote, escape quotes inside it with a backslash, or leave text unquoted (text=Don't save).`,
  )
}

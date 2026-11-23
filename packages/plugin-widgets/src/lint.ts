export * as WidgetLint from "./lint.js"

import type { Widget } from "@opencode/schema/widget"
import { prelude, preludeLive } from "@opencode/widget/source"
import { parseProgram } from "psychoscript"

/** The most a widget template's source may hold, in UTF-8 bytes. */
export const MAX_SOURCE_BYTES = 128 * 1024

export interface Issue {
  readonly message: string
  /** 1-based, in the widget template's source. */
  readonly line?: number
  readonly column?: number
}

// The parser hands back an ESTree program; these are the few node shapes the lint reads.
type Node = {
  readonly type: string
  readonly loc?: { readonly start: { readonly line: number; readonly column: number } }
}
type Declarator = Node & { readonly id: Node & { readonly name?: string }; readonly init?: Node | null }
type Statement = Node & {
  readonly id?: { readonly name: string } | null
  readonly async?: boolean
  readonly kind?: string
  readonly declarations?: ReadonlyArray<Declarator>
}

// Expressions that run code when a top-level `const` is evaluated. Function bodies are skipped: they run later.
const RUNS = new Set([
  "CallExpression",
  "NewExpression",
  "AwaitExpression",
  "YieldExpression",
  "TaggedTemplateExpression",
  "ImportExpression",
  "AssignmentExpression",
  "UpdateExpression",
])
const DEFERRED = new Set(["FunctionExpression", "ArrowFunctionExpression"])
// Removed parts of the widget API (keyed by `object.property` for members), with what to use instead.
const GONE: Record<string, string> = {
  update:
    "`update(state, event)` is gone: attach handlers to nodes (`onPress`, `onChange`, `onPointer`) and define `onKey`/`onFocus`/`onFullscreen`/`onCapture` for other events",
  "widget.event":
    "`widget.event()` is gone: attach handlers to nodes, or `widget.on(...)` for keys, focus, full screen and capture",
  "widget.next":
    "`widget.next()` is gone: await `widget.frame()` or `widget.sleep(ms)`; input arrives through handlers",
  "ui.shader": "`ui.shader` is gone: a GPU canvas is `ui.canvas({ wgsl, values, height, ... })`",
}

/**
 * Parses (never runs) a widget template's source and checks its shape: the entry functions its mode needs, only function and
 * `const` declarations at the top level so nothing runs when the program loads, no redeclared prelude names, no use of
 * the removed API (`update`, `widget.event`, `widget.next`, `ui.shader`), and the size cap. Returns every issue found, in
 * source order.
 */
export function lint(source: string, mode: Widget.Mode): Issue[] {
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES)
    return [{ message: `the source is over ${MAX_SOURCE_BYTES / 1024} KB` }]
  const parsed = parseProgram(source)
  if (!parsed.ok)
    return [
      {
        // The parser's message repeats the position, which the issue carries.
        message: parsed.error.message.replace(/ \(line \d+, col \d+\)$/, ""),
        line: parsed.error.location?.line,
        column: parsed.error.location?.column,
      },
    ]
  const body = parsed.program.body as ReadonlyArray<Statement>
  const issues: Issue[] = []
  const declared = new Map<string, Statement | Declarator>()
  for (const statement of body) {
    if (statement.type === "FunctionDeclaration" && statement.id) {
      declare(statement.id.name, statement)
      continue
    }
    if (statement.type === "VariableDeclaration" && statement.kind === "const") {
      for (const declarator of statement.declarations ?? []) {
        if (declarator.id.type !== "Identifier" || declarator.id.name === undefined)
          issues.push(at(declarator, "top-level constants must bind a single name"))
        else declare(declarator.id.name, declarator)
        const running = declarator.init ? runs(declarator.init) : undefined
        if (running) issues.push(at(running, "top-level constants must not run code (calls, `new`, assignments)"))
      }
      continue
    }
    issues.push(
      at(statement, "only function and `const` declarations may appear at the top level; nothing runs when it loads"),
    )
  }
  const update = declared.get("update")
  if (update) issues.push(at(update, GONE.update!))
  for (const member of removed(parsed.program as Node)) issues.push(at(member.node, GONE[member.name]!))
  if (mode === "step" && !declared.has("view"))
    issues.push({ message: "a step widget template must define `function view(state, data)`" })
  if (mode === "live" && !isAsync(declared.get("main")))
    issues.push({ message: "a live widget template must define `async function main(data)`" })
  return issues.toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0))

  function declare(name: string, node: Statement | Declarator) {
    if (preludeNames().has(name))
      issues.push(at(node, `\`${name}\` is defined by the widget prelude; use another name`))
    if (declared.has(name)) issues.push(at(node, `\`${name}\` is declared twice`))
    declared.set(name, node)
  }
}

/** Issues as one line each: `line 3, col 5: ...`. */
export function format(issues: ReadonlyArray<Issue>) {
  return issues
    .slice(0, 5)
    .map((issue) =>
      issue.line === undefined ? issue.message : `line ${issue.line}, col ${issue.column}: ${issue.message}`,
    )
    .join("; ")
}

function isAsync(node: Statement | Declarator | undefined) {
  if (!node) return false
  if ("async" in node && node.type === "FunctionDeclaration") return node.async === true
  const init = "init" in node ? node.init : undefined
  return init !== null && init !== undefined && DEFERRED.has(init.type) && (init as Statement).async === true
}

function at(node: Node, message: string): Issue {
  // The parser's columns are 0-based; issues use 1-based columns, like its own errors.
  return node.loc ? { message, line: node.loc.start.line, column: node.loc.start.column + 1 } : { message }
}

// The first node under `node` that runs code at load time, skipping function bodies.
function runs(node: Node): Node | undefined {
  if (RUNS.has(node.type)) return node
  if (DEFERRED.has(node.type)) return
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc") continue
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) {
      if (typeof child !== "object" || child === null || typeof (child as Node).type !== "string") continue
      const found = runs(child as Node)
      if (found) return found
    }
  }
}

// Every use of a removed member (`widget.event`, `widget.next`, `ui.shader`) anywhere in the program.
function removed(root: Node) {
  const found: Array<{ node: Node; name: string }> = []
  const visit = (node: Node) => {
    const member = node as Node & { object?: Node & { name?: string }; property?: Node & { name?: string } }
    const name =
      node.type === "MemberExpression" && member.object?.type === "Identifier"
        ? `${member.object.name}.${member.property?.name}`
        : undefined
    if (name !== undefined && GONE[name] !== undefined) found.push({ node, name })
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue
      for (const child of Array.isArray(value) ? value : [value])
        if (typeof child === "object" && child !== null && typeof (child as Node).type === "string")
          visit(child as Node)
    }
  }
  visit(root)
  return found
}

let names: ReadonlySet<string> | undefined
// Every top-level name the preludes declare (the live one's too, in every mode), plus the host globals; read from the
// canonical preludes, not a copy.
function preludeNames() {
  if (names) return names
  const parsed = parseProgram(prelude + "\n" + preludeLive)
  const body = parsed.ok ? (parsed.program.body as ReadonlyArray<Statement>) : []
  names = new Set([
    "__input",
    "__host",
    ...body.flatMap((statement) => [
      ...(statement.id ? [statement.id.name] : []),
      ...(statement.declarations ?? []).flatMap((declarator) =>
        declarator.id.name === undefined ? [] : [declarator.id.name],
      ),
    ]),
  ])
  return names
}

import ts from "typescript"

// Item 23 (Stufe 2): static source lint for workflow scripts. Like the
// MetaReader, this works purely on the AST (ts.createSourceFile) and NEVER
// imports or executes the module — the whole point is to surface capability-
// relevant constructs (process spawning, filesystem/network access, env reads)
// BEFORE any code runs, so the create output and the start approval dialog can
// show them to the human who decides. The lint is advisory by default
// (config `workflows.lint: 'warn'`); `'deny'` makes create/start fail on
// findings and `'off'` disables it. It is deliberately NOT a sandbox: a
// determined script can evade a static lint (computed member access, eval-ish
// tricks) — the runtime ctx.shell permission gate (Stufe 1) and the approval
// visibility are the load-bearing controls; this narrows the casual/accidental
// vector and labels the script honestly.

export type Finding = { line: number; rule: string; text: string }

// node:-builtins whose import/require flags a finding. Matched by the FIRST
// path segment after stripping the optional `node:` prefix, so `fs/promises`
// and `node:fs/promises` both resolve to `fs`.
const FLAGGED_BUILTINS = new Set([
  "fs",
  "child_process",
  "net",
  "http",
  "https",
  "dns",
  "os",
  "worker_threads",
  "vm",
])

// Bun.* members that reach the filesystem / spawn processes / run shell
// commands. `$` is Bun's template shell.
const FLAGGED_BUN_MEMBERS = new Set(["spawn", "spawnSync", "write", "file", "$"])

function moduleRoot(specifier: string): string {
  const stripped = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier
  const slash = stripped.indexOf("/")
  return slash === -1 ? stripped : stripped.slice(0, slash)
}

function isFlaggedModule(specifier: string): boolean {
  return FLAGGED_BUILTINS.has(moduleRoot(specifier))
}

// A finding's `text` is the offending source snippet, truncated so a single
// long line cannot blow up the tool output / approval metadata.
function snippet(node: ts.Node, file: ts.SourceFile): string {
  const text = node.getText(file).replace(/\s+/g, " ").trim()
  return text.length > 120 ? text.slice(0, 117) + "..." : text
}

/**
 * Statically lints a workflow module's SOURCE TEXT for capability-relevant
 * constructs, without importing or executing it. Flagged (rule names in
 * parentheses):
 * - static `import`/`export … from` of a flagged node builtin (`node-builtin-import`)
 * - `require("<builtin>")` of a flagged builtin (`node-builtin-require`)
 * - dynamic `import("<builtin>")` of a flagged builtin (`node-builtin-import`)
 * - dynamic `import(<non-literal>)` — unanalyzable target (`dynamic-import`)
 * - `Bun.spawn`/`Bun.spawnSync`/`Bun.write`/`Bun.file`/`Bun.$` (`bun-api`)
 * - `process.env` reads (`process-env`)
 * - `fetch(...)` calls (`fetch`)
 * Never throws; an unparseable file simply yields the findings the parser
 * could still see (TS recovers aggressively).
 */
export function lint(source: string, filePath: string): { findings: Finding[] } {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const findings: Finding[] = []
  const add = (node: ts.Node, rule: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    findings.push({ line: line + 1, rule, text: snippet(node, file) })
  }

  const visit = (node: ts.Node): void => {
    // `import … from "x"` / `import "x"` / `export … from "x"`.
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isFlaggedModule(node.moduleSpecifier.text)
    ) {
      add(node, "node-builtin-import")
    }
    // `import x = require("y")` (TS import-equals form).
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      isFlaggedModule(node.moduleReference.expression.text)
    ) {
      add(node, "node-builtin-require")
    }
    if (ts.isCallExpression(node)) {
      // Dynamic `import(...)`: a flagged-builtin literal is the builtin rule; a
      // non-literal argument is unanalyzable and flagged as such.
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0]
        if (arg !== undefined && ts.isStringLiteral(arg)) {
          if (isFlaggedModule(arg.text)) add(node, "node-builtin-import")
        } else {
          add(node, "dynamic-import")
        }
      }
      // `require("x")`.
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const arg = node.arguments[0]
        if (arg !== undefined && ts.isStringLiteral(arg)) {
          if (isFlaggedModule(arg.text)) add(node, "node-builtin-require")
        } else {
          add(node, "node-builtin-require")
        }
      }
      // `fetch(...)`.
      if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        add(node, "fetch")
      }
    }
    // `Bun.<member>` for the flagged members (covers `Bun.$\`…\`` too, whose
    // tag is the property access).
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Bun" &&
      FLAGGED_BUN_MEMBERS.has(node.name.text)
    ) {
      add(node, "bun-api")
    }
    // `process.env` (property or element access on it both contain this node).
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.name.text === "env"
    ) {
      add(node, "process-env")
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { findings }
}

export * as SourceLint from "./source-lint"

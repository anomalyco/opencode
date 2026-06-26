import type { WorkflowHelpers } from "./executor"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "workflow.runtime" })

export class WorkflowRuntimeError extends Error {
  constructor(message: string, public readonly script?: string) {
    super(message)
    this.name = "WorkflowRuntimeError"
  }
}

// Defense-in-depth: block known dangerous patterns at the source level.
// The sandbox (restricted globals via parameter shadowing) is the primary
// defense; this catches issues early with clear error messages.
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brequire\s*\(/, reason: "require() is not allowed in workflow scripts" },
  { pattern: /\bimport\s+/, reason: "import statements are not allowed in workflow scripts" },
  { pattern: /\bprocess\./, reason: "process.* is not allowed in workflow scripts" },
  { pattern: /\bglobalThis\b/, reason: "globalThis is not allowed in workflow scripts" },
  { pattern: /\beval\s*\(/, reason: "eval() is not allowed in workflow scripts" },
  { pattern: /\bnew\s+Function\s*\(/, reason: "new Function() is not allowed in workflow scripts" },
  { pattern: /\bchild_process\b/, reason: "child_process is not allowed in workflow scripts" },
  { pattern: /\b__dirname\b/, reason: "__dirname is not allowed in workflow scripts" },
  { pattern: /\b__filename\b/, reason: "__filename is not allowed in workflow scripts" },
  { pattern: /\bfetch\s*\(/, reason: "fetch() is not allowed — use the agent() helper with a web-capable subagent" },
  { pattern: /\bXMLHttpRequest\b/, reason: "XMLHttpRequest is not allowed in workflow scripts" },
  { pattern: /\bsetTimeout\b/, reason: "setTimeout is not allowed — use the sleep() helper instead" },
  { pattern: /\bsetInterval\b/, reason: "setInterval is not allowed — use the sleep() helper instead" },
  { pattern: /\bsetImmediate\b/, reason: "setImmediate is not allowed in workflow scripts" },
  { pattern: /\bBuffer\b/, reason: "Buffer is not allowed in workflow scripts" },
  { pattern: /\bReflect\b/, reason: "Reflect is not allowed in workflow scripts (sandbox escape risk)" },
  { pattern: /\bProxy\b/, reason: "Proxy is not allowed in workflow scripts (sandbox escape risk)" },
  { pattern: /\bWeakRef\b/, reason: "WeakRef is not allowed in workflow scripts" },
  { pattern: /\bSharedArrayBuffer\b/, reason: "SharedArrayBuffer is not allowed in workflow scripts" },
  { pattern: /\bAtomics\b/, reason: "Atomics is not allowed in workflow scripts" },
]

function findLineNumber(source: string, pattern: RegExp): number {
  const lines = source.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1
  }
  return 0
}

function validateScript(source: string): void {
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(source)) {
      const line = findLineNumber(source, pattern)
      const location = line > 0 ? ` at line ${line}` : ""
      throw new WorkflowRuntimeError(`${reason}${location}`, source)
    }
  }
}

// Allowed globals — passed as parameters to shadow real globals within the script.
// Only safe, stateless utilities are exposed.
const ALLOWED_GLOBALS: ReadonlyArray<string> = [
  "JSON", "Math", "Array", "Object", "String", "Number", "Boolean",
  "Date", "RegExp", "Map", "Set", "Promise", "Error",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "console",
]

// Build a restricted globalThis proxy that only exposes allowed globals.
// This prevents scripts from accessing process, require, fs, etc. via globalThis.
function buildRestrictedGlobalThis(): Record<string, unknown> {
  const allowed: Record<string, unknown> = {}
  for (const name of ALLOWED_GLOBALS) {
    allowed[name] = (globalThis as Record<string, unknown>)[name]
  }
  return allowed
}

export async function executeScript(
  source: string,
  helpers: WorkflowHelpers,
  args: string,
): Promise<unknown> {
  validateScript(source)

  // Wrap the script in an async function. The helpers and allowed globals are
  // passed as parameters, which shadows the real globals within the function scope.
  // A restricted `globalThis` is also passed to prevent access to blocked APIs.
  const wrappedScript = `
"use strict"
return (async function(agent, parallel, sleep, args, globalThis, ${ALLOWED_GLOBALS.join(", ")}) {
${source}
})
`

  // eslint-disable-next-line no-new-func
  const fn = new Function(wrappedScript)()
  const restrictedGlobal = buildRestrictedGlobalThis()
  const globalValues = ALLOWED_GLOBALS.map((name) => (globalThis as Record<string, unknown>)[name])

  log.info("running workflow script", { length: source.length })

  return await fn(helpers.agent, helpers.parallel, helpers.sleep, args, restrictedGlobal, ...globalValues)
}

export * as WorkflowRuntime from "./runtime"

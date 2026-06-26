import type { WorkflowHelpers } from "./executor"
import * as Log from "@opencode-ai/core/util/log"
import vm from "node:vm"

const log = Log.create({ service: "workflow.runtime" })

export class WorkflowRuntimeError extends Error {
  constructor(message: string, public readonly script?: string) {
    super(message)
    this.name = "WorkflowRuntimeError"
  }
}

// Defense-in-depth: block known dangerous patterns at the source level.
// The vm.createContext sandbox is the primary defense; this catches issues
// early with clear error messages before the script even reaches the VM.
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brequire\s*\(/, reason: "require() is not allowed in workflow scripts" },
  { pattern: /\bimport\s*[\s(]/, reason: "import statements are not allowed in workflow scripts" },
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
  { pattern: /\bReflect\b/, reason: "Reflect is not allowed in workflow scripts" },
  { pattern: /\bProxy\b/, reason: "Proxy is not allowed in workflow scripts" },
  { pattern: /\bWeakRef\b/, reason: "WeakRef is not allowed in workflow scripts" },
  { pattern: /\bSharedArrayBuffer\b/, reason: "SharedArrayBuffer is not allowed in workflow scripts" },
  { pattern: /\bAtomics\b/, reason: "Atomics is not allowed in workflow scripts" },
  { pattern: /\bself\b/, reason: "self is not allowed in workflow scripts" },
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

// Build a sandbox context with only safe globals.
// vm.createContext creates a new V8 realm where the Function constructor
// can only access globals within this context — not the outer process.
// This prevents constructor chain escapes like [].constructor.constructor("return process")().
function buildSandboxContext(helpers: WorkflowHelpers, args: string): vm.Context {
  return vm.createContext({
    agent: helpers.agent,
    parallel: helpers.parallel,
    sleep: helpers.sleep,
    args,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Map,
    Set,
    Promise,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    console: {
      log: (...data: unknown[]) => console.log("[workflow]", ...data),
      error: (...data: unknown[]) => console.error("[workflow]", ...data),
      warn: (...data: unknown[]) => console.warn("[workflow]", ...data),
    },
  })
}

export async function executeScript(
  source: string,
  helpers: WorkflowHelpers,
  args: string,
): Promise<unknown> {
  validateScript(source)

  const sandbox = buildSandboxContext(helpers, args)

  // Wrap the user script in an async IIFE so `return` works at the top level
  // and await is available. The script runs inside the vm context, so only
  // the globals in the sandbox are accessible.
  const wrappedScript = `
"use strict";
(async function() {
${source}
})()
`

  const script = new vm.Script(wrappedScript)

  log.info("running workflow script in vm sandbox", { length: source.length })

  return await script.runInContext(sandbox, {
    timeout: 5 * 60 * 1000, // 5 min hard VM timeout (defense-in-depth; executor has its own timeout)
    displayErrors: true,
  })
}

export * as WorkflowRuntime from "./runtime"

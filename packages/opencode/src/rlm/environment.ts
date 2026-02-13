/**
 * RLM Environment - Sandboxed JavaScript REPL
 *
 * Provides a sandboxed JavaScript execution environment for RLM code execution.
 * Uses Node's `vm` module with `createContext`/`runInContext` for isolation.
 *
 * Security properties:
 * - Code runs in an isolated vm context — no access to `process`, `require`,
 *   `Bun`, `module`, `__dirname`, `__filename`, or any Node/Bun builtins
 * - Only explicitly whitelisted globals are available (Math, JSON, Array, etc.)
 * - console.log/console.error are intercepted for stdout/stderr capture
 *
 * Key features:
 * - Variables persist across executeCode() calls (vm context is reused)
 * - `const`, `let`, `var`, and bare assignments all persist across calls
 * - Top-level `const`/`let` are also hoisted to bare assignments so they
 *   appear in the context object (visible in serializeLocals/SHOW_VARS)
 * - Injected functions: llm_query(), llm_query_batched(), FINAL_VAR(), SHOW_VARS()
 * - All code runs in an async wrapper so top-level `await` works
 * - Errors are caught gracefully — the REPL continues working after errors
 */

import * as vm from "node:vm"
import type { REPLResult } from "./types"

/** Function that handles llm_query() calls from inside the REPL */
export type LLMQueryHandler = (prompt: string, model?: string) => Promise<string>

/** Function that handles batched llm_query() calls */
export type LLMQueryBatchedHandler = (prompts: string[], model?: string) => Promise<string[]>

/** Default execution timeout in milliseconds (30 seconds) */
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000

export interface LocalREPLOptions {
  /** Handler for llm_query() calls from inside the REPL */
  llmQueryHandler: LLMQueryHandler
  /** Handler for llm_query_batched() calls from inside the REPL */
  llmQueryBatchedHandler?: LLMQueryBatchedHandler
  /** Initial context to load into the REPL */
  contextPayload?: string | Record<string, unknown> | unknown[]
  /**
   * Maximum execution time per executeCode() call in milliseconds.
   * - Synchronous infinite loops (e.g. `while(true){}`) are terminated by
   *   vm.runInContext's built-in `timeout` option.
   * - Async operations (e.g. hanging awaits) are terminated by a Promise.race
   *   with a timer.
   * - Set to 0 or Infinity to disable.
   * - Default: 30000 (30 seconds)
   */
  executionTimeoutMs?: number
}

// Names injected into every execution scope — excluded from user-visible variables
const INTERNAL_NAMES = new Set([
  "llm_query",
  "llm_query_batched",
  "FINAL",
  "FINAL_VAR",
  "SHOW_VARS",
  "console",
  "__rlm_final__",
])

/**
 * Whitelisted globals exposed to the vm sandbox.
 * These are safe, side-effect-free constructors and utilities.
 */
const SANDBOX_GLOBALS: Record<string, unknown> = {
  // Primitives & constructors
  Array,
  ArrayBuffer,
  BigInt,
  Boolean,
  DataView,
  Date,
  Error,
  EvalError,
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Infinity,
  JSON,
  Map,
  Math,
  NaN,
  Number,
  Object,
  Promise,
  Proxy,
  RangeError,
  ReferenceError,
  RegExp,
  Set,
  String,
  Symbol,
  SyntaxError,
  TypeError,
  URIError,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  WeakMap,
  WeakSet,
  WeakRef,

  // Global functions
  decodeURI,
  decodeURIComponent,
  encodeURI,
  encodeURIComponent,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  structuredClone,

  // Async utilities
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,

  // Constants
  undefined,
}

export class LocalREPL {
  /** The vm context — acts as the global scope for executed code */
  private ctx: vm.Context | null = null
  private llmQueryHandler: LLMQueryHandler
  private llmQueryBatchedHandler: LLMQueryBatchedHandler
  private contextPayload?: string | Record<string, unknown> | unknown[]
  private contextCount = 0
  private ready = false
  private executionTimeoutMs: number
  /** Stores the value passed to FINAL() when called from code */
  private finalValue: string | undefined = undefined
  /** Whether FINAL() was called from within a code block */
  private finalCalled = false

  constructor(options: LocalREPLOptions) {
    this.llmQueryHandler = options.llmQueryHandler
    this.llmQueryBatchedHandler =
      options.llmQueryBatchedHandler ??
      (async (prompts, model) => {
        return Promise.all(prompts.map((p) => this.llmQueryHandler(p, model)))
      })
    this.contextPayload = options.contextPayload
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
  }

  /**
   * Initialize the REPL execution context.
   * Creates a sandboxed vm context with whitelisted globals and injected helpers.
   */
  async start(): Promise<void> {
    // Create the sandbox with whitelisted globals
    const sandbox: Record<string, unknown> = { ...SANDBOX_GLOBALS }

    // Inject helper functions
    sandbox.llm_query = (prompt: string, model?: string) => this.llmQueryHandler(prompt, model)
    sandbox.llm_query_batched = (prompts: string[], model?: string) =>
      this.llmQueryBatchedHandler(prompts, model)

    sandbox.FINAL_VAR = (variableName: string): string => {
      const name = String(variableName).trim().replace(/^["']|["']$/g, "")
      if (this.ctx && name in this.ctx && !INTERNAL_NAMES.has(name)) {
        const value = String(this.ctx[name])
        this.finalCalled = true
        this.finalValue = value
        return value
      }
      const available = this.ctx
        ? Object.keys(this.ctx).filter((k) => !k.startsWith("_") && !INTERNAL_NAMES.has(k) && !(k in SANDBOX_GLOBALS))
        : []
      if (available.length > 0) {
        return `Error: Variable '${name}' not found. Available variables: [${available.map((v) => `"${v}"`).join(", ")}].`
      }
      return `Error: Variable '${name}' not found. No variables created yet.`
    }

    sandbox.FINAL = (answer: unknown): string => {
      const value = typeof answer === "string" ? answer : inspectValue(answer)
      this.finalCalled = true
      this.finalValue = value
      return value
    }

    sandbox.SHOW_VARS = (): string => {
      if (!this.ctx) return "REPL not initialized."
      const available: Record<string, string> = {}
      for (const [k, v] of Object.entries(this.ctx)) {
        if (k.startsWith("_") || INTERNAL_NAMES.has(k) || k in SANDBOX_GLOBALS) continue
        available[k] = typeof v === "function" ? "function" : typeof v
      }
      if (Object.keys(available).length === 0) {
        return "No variables created yet. Use ```repl``` blocks to create variables."
      }
      return `Available variables: ${JSON.stringify(available)}`
    }

    // Create the isolated vm context
    this.ctx = vm.createContext(sandbox)
    this.ready = true

    // Load initial context if provided
    if (this.contextPayload !== undefined) {
      await this.loadContext(this.contextPayload)
    }
  }

  /**
   * Load context into the REPL environment.
   */
  async loadContext(context: string | Record<string, unknown> | unknown[], index?: number): Promise<void> {
    if (!this.ctx) throw new Error("REPL not started. Call start() first.")

    const contextIndex = index ?? this.contextCount
    const varName = `context_${contextIndex}`

    this.ctx[varName] = context
    // When it's the first context (ends with _0), also alias as "context"
    if (varName.endsWith("_0")) {
      this.ctx["context"] = context
    }

    this.contextCount = Math.max(this.contextCount, contextIndex + 1)
  }

  /**
   * Execute JavaScript code in the sandboxed REPL and return the result.
   * Code runs in an async wrapper so top-level `await` works.
   * Variables assigned in the code persist in the vm context.
   */
  async executeCode(code: string): Promise<REPLResult> {
    if (!this.ready || !this.ctx) {
      throw new Error("REPL not started. Call start() first.")
    }

    const startTime = performance.now()
    const stdoutParts: string[] = []
    const stderrParts: string[] = []

    // Build a fake console that captures output
    const fakeConsole = {
      log: (...args: unknown[]) => {
        stdoutParts.push(args.map((a) => (typeof a === "string" ? a : inspectValue(a))).join(" ") + "\n")
      },
      error: (...args: unknown[]) => {
        stderrParts.push(args.map((a) => (typeof a === "string" ? a : inspectValue(a))).join(" ") + "\n")
      },
      warn: (...args: unknown[]) => {
        stderrParts.push(args.map((a) => (typeof a === "string" ? a : inspectValue(a))).join(" ") + "\n")
      },
      info: (...args: unknown[]) => {
        stdoutParts.push(args.map((a) => (typeof a === "string" ? a : inspectValue(a))).join(" ") + "\n")
      },
      dir: (...args: unknown[]) => {
        stdoutParts.push(args.map((a) => inspectValue(a)).join(" ") + "\n")
      },
    }

    // Inject the fake console into the vm context
    this.ctx.console = fakeConsole

    const timeoutMs = this.executionTimeoutMs

    try {
      // Pre-process: transform top-level const/let/var declarations into bare
      // assignments so they appear on the context object (visible in serializeLocals
      // and SHOW_VARS). In the vm, const/let persist across calls regardless, but
      // only bare assignments and var are enumerable on the context object.
      const processedCode = hoistDeclarations(code)

      // Wrap in an async IIFE so top-level `await` works
      const wrappedCode = `(async () => {\n${processedCode}\n})()`

      // vm.runInContext's `timeout` option catches synchronous infinite loops
      // (e.g. `while(true){}`). For async operations, we use Promise.race.
      const vmOptions: vm.RunningCodeOptions = {}
      if (timeoutMs > 0 && isFinite(timeoutMs)) {
        vmOptions.timeout = timeoutMs
      }

      const result = vm.runInContext(wrappedCode, this.ctx, vmOptions)

      // Await the async IIFE's promise, with a timeout guard for async hangs
      if (timeoutMs > 0 && isFinite(timeoutMs)) {
        await withTimeout(result, timeoutMs)
      } else {
        await result
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err)
      stderrParts.push(errMsg)
    }

    return {
      stdout: stdoutParts.join(""),
      stderr: stderrParts.join(""),
      locals: this.serializeLocals(),
      executionTime: (performance.now() - startTime) / 1000,
      rlmCalls: [],
    }
  }

  /**
   * Get the number of contexts loaded.
   */
  getContextCount(): number {
    return this.contextCount
  }

  /**
   * Check if FINAL() or FINAL_VAR() was called from within a code block.
   */
  hasFinalAnswer(): boolean {
    return this.finalCalled
  }

  /**
   * Get the final answer value set by FINAL() or FINAL_VAR() from code.
   * Returns undefined if not called.
   */
  getFinalAnswer(): string | undefined {
    return this.finalValue
  }

  /**
   * Reset the final answer state (called between iterations if needed).
   */
  resetFinalAnswer(): void {
    this.finalCalled = false
    this.finalValue = undefined
  }

  /**
   * Clean up the REPL — releases the vm context.
   */
  async cleanup(): Promise<void> {
    this.ctx = null
    this.ready = false
    this.contextCount = 0
  }

  /**
   * Serialize the current scope variables for reporting.
   * Excludes internal/injected names, underscore-prefixed variables, and sandbox globals.
   */
  private serializeLocals(): Record<string, unknown> {
    if (!this.ctx) return {}
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(this.ctx)) {
      if (k.startsWith("_") || INTERNAL_NAMES.has(k) || k in SANDBOX_GLOBALS) continue
      try {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          result[k] = v
        } else if (Array.isArray(v)) {
          result[k] = `<Array length=${v.length}>`
        } else if (v && typeof v === "object") {
          const keys = Object.keys(v)
          result[k] = `<Object keys=${keys.length}>`
        } else if (typeof v === "function") {
          result[k] = `<function>`
        } else if (v === null) {
          result[k] = null
        } else if (v === undefined) {
          result[k] = undefined
        } else {
          result[k] = `<${typeof v}>`
        }
      } catch {
        result[k] = `<${typeof v}>`
      }
    }
    return result
  }
}

// ============================================================
// Declaration Hoisting
// ============================================================

/**
 * Transform top-level `const`, `let`, and `var` declarations into bare
 * assignments so they are captured by the Proxy's `set()` trap and persist
 * across executeCode() calls.
 *
 * Only transforms declarations at the top level (brace depth 0). Declarations
 * inside functions, loops, if-blocks, etc. are left untouched.
 *
 * Handles:
 * - Simple:         `const x = 42`        → `x = 42`
 * - Multiple:       `let a = 1, b = 2`    → `a = 1; b = 2`
 * - No initializer: `let x`               → `x = undefined`
 * - Array destructure: `const [a, b] = [1, 2]` → `[a, b] = [1, 2]` (kept, assignment target works)
 * - Object destructure: `const { a, b } = obj` → `void function() { const { a, b } = obj; ... }` (uses wrapper)
 * - For-loop heads: `for (let i = 0; ...)` → left untouched (part of a block construct)
 * - Nested:         `function f() { const x = 1 }` → left untouched
 *
 * The transformation is intentionally conservative — it only matches lines that
 * clearly start with const/let/var at brace depth 0. If the regex doesn't match
 * a complex pattern, the code passes through unchanged (the model's code still
 * runs, variables just won't persist).
 */
export function hoistDeclarations(code: string): string {
  const lines = code.split("\n")
  const result: string[] = []
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Count net brace changes on lines BEFORE this one to determine current depth.
    // We need to know the depth at the START of this line.
    if (braceDepth === 0) {
      const transformed = transformDeclarationLine(line)
      if (transformed !== null) {
        result.push(transformed)
        braceDepth += netBraces(line)
        continue
      }
    }

    result.push(line)
    braceDepth += netBraces(line)
    // Clamp to 0 in case of unbalanced braces (shouldn't happen in valid code)
    if (braceDepth < 0) braceDepth = 0
  }

  return result.join("\n")
}

/**
 * Count the net change in brace depth for a line.
 * Skips braces inside string literals and comments.
 */
function netBraces(line: string): number {
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escaped = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === "\\") {
      escaped = true
      continue
    }

    // Handle string literals
    if (ch === "'" && !inDouble && !inTemplate) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle && !inTemplate) {
      inDouble = !inDouble
      continue
    }
    if (ch === "`" && !inSingle && !inDouble) {
      inTemplate = !inTemplate
      continue
    }

    if (inSingle || inDouble || inTemplate) continue

    // Skip line comments
    if (ch === "/" && i + 1 < line.length && line[i + 1] === "/") break

    if (ch === "{") depth++
    else if (ch === "}") depth--
  }

  return depth
}

/**
 * Attempt to transform a single line that starts with const/let/var into
 * bare assignments. Returns the transformed line, or null if the line
 * doesn't match the pattern.
 */
function transformDeclarationLine(line: string): string | null {
  // Match lines starting with const/let/var (with optional whitespace)
  const match = line.match(/^(\s*)(const|let|var)\s+(.+)$/)
  if (!match) return null

  const indent = match[1]
  const declBody = match[3]

  // Skip for-loop declarations: `for (let i = 0; ...`
  // These are detected by the presence of `for` before the declaration on the same
  // logical line. Since we split by newlines, for-loop heads where `for (` is on a
  // previous line won't match this function anyway. But check for inline for-loops.
  // Actually, `for (let ...` would be inside parentheses which means the `let` is
  // not at column 0. But since we're looking at full lines, a for-loop head like
  // `for (let i = 0; i < 10; i++) {` has `for` before `let`. We only match lines
  // where const/let/var is the first keyword, so for-loops are naturally excluded.

  // Handle destructuring patterns
  if (declBody.startsWith("[")) {
    // Array destructuring: `const [a, b] = [1, 2]` → `[a, b] = [1, 2]`
    // This works because `[a, b] = expr` is a valid assignment expression
    // when a and b are captured by the Proxy
    return indent + declBody
  }

  if (declBody.startsWith("{")) {
    // Object destructuring: `const { a, b } = obj` → needs special handling
    // Bare `{ a, b } = obj` is a syntax error (leading `{` is parsed as block).
    // Wrap in parens: `({ a, b } = obj)` — this is valid and the Proxy captures assignments.
    // Find the `= expr` part
    const eqIndex = findTopLevelEquals(declBody)
    if (eqIndex === -1) return null
    const pattern = declBody.slice(0, eqIndex).trim()
    const value = declBody.slice(eqIndex + 1).trim()
    return `${indent};(${pattern} = ${value})`
  }

  // Simple declarations, possibly with multiple declarators: `let a = 1, b = 2`
  // Split by commas at the top level (not inside parens/brackets/braces)
  const declarators = splitDeclarators(declBody)
  const assignments: string[] = []

  for (const decl of declarators) {
    const trimmed = decl.trim()
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) {
      // No initializer: `let x` → `x = undefined`
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?\s*$/.test(trimmed)) {
        const varName = trimmed.replace(/\s*;?\s*$/, "")
        assignments.push(`${varName} = undefined`)
      } else {
        // Complex pattern without initializer — can't transform
        return null
      }
    } else {
      const name = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      // Validate it's a simple identifier
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
        assignments.push(`${name} = ${value}`)
      } else {
        // Complex pattern (destructuring mixed into comma list) — can't transform
        return null
      }
    }
  }

  if (assignments.length === 0) return null
  return indent + assignments.join("; ")
}

/**
 * Find the index of the top-level `=` in a destructuring declaration.
 * Skips `=` inside nested brackets/braces.
 */
function findTopLevelEquals(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "{" || ch === "[" || ch === "(") depth++
    else if (ch === "}" || ch === "]" || ch === ")") depth--
    else if (ch === "=" && depth === 0 && s[i + 1] !== "=") return i
  }
  return -1
}

/**
 * Split declarators by top-level commas (not inside parens/brackets/braces/strings).
 */
function splitDeclarators(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escaped = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === "\\") {
      current += ch
      escaped = true
      continue
    }

    if (ch === "'" && !inDouble && !inTemplate) {
      inSingle = !inSingle
      current += ch
      continue
    }
    if (ch === '"' && !inSingle && !inTemplate) {
      inDouble = !inDouble
      current += ch
      continue
    }
    if (ch === "`" && !inSingle && !inDouble) {
      inTemplate = !inTemplate
      current += ch
      continue
    }

    if (inSingle || inDouble || inTemplate) {
      current += ch
      continue
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      depth++
      current += ch
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--
      current += ch
    } else if (ch === "," && depth === 0) {
      parts.push(current)
      current = ""
    } else {
      current += ch
    }
  }

  if (current.trim()) parts.push(current)
  return parts
}

/**
 * Simple value inspector for console output (similar to util.inspect).
 */
function inspectValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ============================================================
// Timeout Utilities
// ============================================================

/** Error thrown when code execution exceeds the configured timeout */
export class ExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Code execution timed out after ${timeoutMs}ms`)
    this.name = "ExecutionTimeoutError"
  }
}

/**
 * Race a promise against a timeout. Rejects with ExecutionTimeoutError
 * if the promise doesn't resolve within the given time.
 *
 * This handles async timeouts (e.g. hanging `await` calls).
 * Synchronous infinite loops are handled by vm.runInContext's
 * built-in `timeout` option.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ExecutionTimeoutError(timeoutMs))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

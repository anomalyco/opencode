import { describe, expect, test, afterEach } from "bun:test"
import { LocalREPL, hoistDeclarations } from "../../src/rlm/environment"

/**
 * Tests for the native JavaScript REPL (LocalREPL class).
 *
 * These tests verify the in-process JavaScript execution engine:
 *
 * 1. Startup & initialization
 * 2. Basic code execution (console.log, variables, expressions)
 * 3. Variable persistence across executions
 * 4. Error handling (syntax errors, runtime errors)
 * 5. Context loading
 * 6. llm_query() round-trips (async)
 * 7. llm_query_batched() round-trips
 * 8. FINAL_VAR() and SHOW_VARS() functions
 * 9. Graceful cleanup
 * 10. Stdout capture isolation
 */

let repl: LocalREPL | null = null

afterEach(async () => {
  if (repl) {
    await repl.cleanup()
    repl = null
  }
})

function createREPL(overrides?: {
  llmQueryHandler?: (prompt: string, model?: string) => Promise<string>
  llmQueryBatchedHandler?: (prompts: string[], model?: string) => Promise<string[]>
  contextPayload?: string | Record<string, unknown> | unknown[]
  executionTimeoutMs?: number
}) {
  repl = new LocalREPL({
    llmQueryHandler:
      overrides?.llmQueryHandler ?? (async (prompt) => `echo: ${prompt}`),
    llmQueryBatchedHandler: overrides?.llmQueryBatchedHandler,
    contextPayload: overrides?.contextPayload,
    executionTimeoutMs: overrides?.executionTimeoutMs,
  })
  return repl
}

// ============================================================
// 1. Startup & Initialization
// ============================================================

describe("REPL startup", () => {
  test("starts successfully", async () => {
    const r = createREPL()
    await r.start()
    // If start() returns without error, the REPL is ready
    expect(true).toBe(true)
  })

  test("executeCode throws if not started", async () => {
    const r = createREPL()
    expect(r.executeCode('console.log("hi")')).rejects.toThrow("not started")
  })
})

// ============================================================
// 2. Basic Code Execution
// ============================================================

describe("basic execution", () => {
  test("console.log captures stdout", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode('console.log("hello world")')
    expect(result.stdout).toBe("hello world\n")
    expect(result.stderr).toBe("")
  })

  test("variable assignment and access", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("x = 42; console.log(x)")
    expect(result.stdout).toBe("42\n")
    expect(result.locals).toHaveProperty("x", 42)
  })

  test("arithmetic expression", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("result = 2 + 3 * 4; console.log(result)")
    expect(result.stdout).toBe("14\n")
    expect(result.locals).toHaveProperty("result", 14)
  })

  test("multi-line code execution", async () => {
    const r = createREPL()
    await r.start()

    const code = `
items = [1, 2, 3, 4, 5]
total = items.reduce((a, b) => a + b, 0)
avg = total / items.length
console.log(\`sum=\${total}, avg=\${avg}\`)
`
    const result = await r.executeCode(code)
    expect(result.stdout).toContain("sum=15, avg=3")
    expect(result.locals).toHaveProperty("total", 15)
    expect(result.locals).toHaveProperty("avg", 3)
  })

  test("Math module works", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("pi_val = Math.PI; console.log(Math.round(pi_val * 10000) / 10000)")
    expect(result.stdout).toBe("3.1416\n")
  })
})

// ============================================================
// 3. Variable Persistence Across Executions
// ============================================================

describe("variable persistence", () => {
  test("variables persist across multiple executeCode calls", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("a = 10")
    await r.executeCode("b = 20")
    const result = await r.executeCode("c = a + b; console.log(c)")

    expect(result.stdout).toBe("30\n")
    expect(result.locals).toHaveProperty("a", 10)
    expect(result.locals).toHaveProperty("b", 20)
    expect(result.locals).toHaveProperty("c", 30)
  })

  test("functions persist across executions", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("double = function(x) { return x * 2 }")
    const result = await r.executeCode("val = double(21); console.log(val)")
    expect(result.stdout).toBe("42\n")
  })
})

// ============================================================
// 4. Error Handling
// ============================================================

describe("error handling", () => {
  test("syntax error returns stderr", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("if (true console.log('bad')")
    expect(result.stderr).toContain("SyntaxError")
  })

  test("runtime error returns stderr", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("null.property")
    expect(result.stderr).toContain("TypeError")
  })

  test("ReferenceError for undefined variable", async () => {
    const r = createREPL()
    await r.start()

    // In the vm sandbox, accessing an undefined variable throws ReferenceError
    const result = await r.executeCode("undefined_var.toString()")
    expect(result.stderr).toContain("ReferenceError")
  })

  test("REPL continues working after an error", async () => {
    const r = createREPL()
    await r.start()

    // Cause an error
    await r.executeCode("null.property")

    // Should still work
    const result = await r.executeCode("y = 99; console.log(y)")
    expect(result.stdout).toBe("99\n")
    expect(result.stderr).toBe("")
  })

  test("partial output captured before error", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode('console.log("before"); null.property; console.log("after")')
    expect(result.stdout).toContain("before")
    expect(result.stderr).toContain("TypeError")
    // "after" should NOT appear since the exception interrupted execution
    expect(result.stdout).not.toContain("after")
  })
})

// ============================================================
// 5. Context Loading
// ============================================================

describe("context loading", () => {
  test("string context is loaded as context_0", async () => {
    const r = createREPL({ contextPayload: "hello context" })
    await r.start()

    // context_0 should be accessible, and since it ends in _0, also "context"
    const result = await r.executeCode("console.log(context_0); console.log(context)")
    expect(result.stdout).toContain("hello context")
    expect(r.getContextCount()).toBe(1)
  })

  test("dict context is loaded", async () => {
    const r = createREPL({ contextPayload: { key: "value", num: 42 } })
    await r.start()

    const result = await r.executeCode("console.log(context_0.key)")
    expect(result.stdout).toContain("value")
  })

  test("list context is loaded", async () => {
    const r = createREPL({ contextPayload: [1, 2, 3] })
    await r.start()

    const result = await r.executeCode("console.log(context_0.length)")
    expect(result.stdout).toContain("3")
  })

  test("additional context can be loaded after start", async () => {
    const r = createREPL()
    await r.start()

    await r.loadContext("first", 0)
    await r.loadContext("second", 1)

    const result = await r.executeCode("console.log(context_0, context_1)")
    expect(result.stdout).toContain("first")
    expect(result.stdout).toContain("second")
    expect(r.getContextCount()).toBe(2)
  })
})

// ============================================================
// 6. llm_query() Round-Trips
// ============================================================

describe("llm_query round-trips", () => {
  test("llm_query() routes through handler and returns result", async () => {
    const queries: string[] = []
    const r = createREPL({
      llmQueryHandler: async (prompt) => {
        queries.push(prompt)
        return `The answer is 42`
      },
    })
    await r.start()

    const result = await r.executeCode(
      'response = await llm_query("What is the meaning of life?"); console.log(response)',
    )
    expect(result.stdout).toContain("The answer is 42")
    expect(queries).toEqual(["What is the meaning of life?"])
  })

  test("multiple llm_query() calls in one execution", async () => {
    let callCount = 0
    const r = createREPL({
      llmQueryHandler: async (prompt) => {
        callCount++
        return `response-${callCount}`
      },
    })
    await r.start()

    const result = await r.executeCode(
      'r1 = await llm_query("q1"); r2 = await llm_query("q2"); console.log(r1, r2)',
    )
    expect(result.stdout).toContain("response-1")
    expect(result.stdout).toContain("response-2")
    expect(callCount).toBe(2)
  })

  test("llm_query() with no model passes undefined", async () => {
    let receivedModel: string | undefined = "not-called"
    const r = createREPL({
      llmQueryHandler: async (prompt, model) => {
        receivedModel = model
        return "ok"
      },
    })
    await r.start()

    await r.executeCode('await llm_query("test")')
    expect(receivedModel).toBeUndefined()
  })
})

// ============================================================
// 7. llm_query_batched() Round-Trips
// ============================================================

describe("llm_query_batched round-trips", () => {
  test("batched queries route through handler", async () => {
    const r = createREPL({
      llmQueryBatchedHandler: async (prompts) => {
        return prompts.map((p, i) => `answer-${i}: ${p}`)
      },
    })
    await r.start()

    const result = await r.executeCode(
      'results = await llm_query_batched(["q1", "q2", "q3"]); results.forEach(r => console.log(r))',
    )
    expect(result.stdout).toContain("answer-0: q1")
    expect(result.stdout).toContain("answer-1: q2")
    expect(result.stdout).toContain("answer-2: q3")
  })

  test("batched falls back to sequential when no batched handler", async () => {
    let callCount = 0
    const r = createREPL({
      llmQueryHandler: async (prompt) => {
        callCount++
        return `seq-${callCount}`
      },
      // No llmQueryBatchedHandler — should fall back to sequential
    })
    await r.start()

    const result = await r.executeCode(
      'results = await llm_query_batched(["a", "b"]); results.forEach(r => console.log(r))',
    )
    expect(result.stdout).toContain("seq-1")
    expect(result.stdout).toContain("seq-2")
    expect(callCount).toBe(2)
  })
})

// ============================================================
// 8. FINAL_VAR() and SHOW_VARS()
// ============================================================

describe("FINAL_VAR and SHOW_VARS", () => {
  test("FINAL_VAR returns variable value", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("answer = 'the final answer'")
    const result = await r.executeCode('console.log(FINAL_VAR("answer"))')
    expect(result.stdout).toContain("the final answer")
  })

  test("FINAL_VAR sets hasFinalAnswer flag", async () => {
    const r = createREPL()
    await r.start()

    expect(r.hasFinalAnswer()).toBe(false)
    await r.executeCode("answer = 'done'")
    await r.executeCode('FINAL_VAR("answer")')
    expect(r.hasFinalAnswer()).toBe(true)
    expect(r.getFinalAnswer()).toBe("done")
  })

  test("FINAL_VAR does not set flag for non-existent variable", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode('FINAL_VAR("nonexistent")')
    expect(r.hasFinalAnswer()).toBe(false)
  })

  test("FINAL_VAR returns error for non-existent variable", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode('console.log(FINAL_VAR("nonexistent"))')
    expect(result.stdout).toContain("Error")
    expect(result.stdout).toContain("not found")
  })

  test("SHOW_VARS lists available variables", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("x = 1; y = 'hello'; z = [1,2,3]")
    const result = await r.executeCode("console.log(SHOW_VARS())")
    expect(result.stdout).toContain("x")
    expect(result.stdout).toContain("y")
    expect(result.stdout).toContain("z")
  })

  test("SHOW_VARS returns message when no variables exist", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("console.log(SHOW_VARS())")
    expect(result.stdout).toContain("No variables")
  })
})

// ============================================================
// 8b. FINAL() function
// ============================================================

describe("FINAL function", () => {
  test("FINAL sets hasFinalAnswer and stores value", async () => {
    const r = createREPL()
    await r.start()

    expect(r.hasFinalAnswer()).toBe(false)
    await r.executeCode('FINAL("hello world")')
    expect(r.hasFinalAnswer()).toBe(true)
    expect(r.getFinalAnswer()).toBe("hello world")
  })

  test("FINAL works with string concatenation", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("x = 'answer is ' + 42")
    await r.executeCode("FINAL(x)")
    expect(r.hasFinalAnswer()).toBe(true)
    expect(r.getFinalAnswer()).toBe("answer is 42")
  })

  test("FINAL works with numbers", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("FINAL(42)")
    expect(r.getFinalAnswer()).toBe("42")
  })

  test("FINAL works with objects (serialized)", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode('FINAL({a: 1, b: "two"})')
    expect(r.hasFinalAnswer()).toBe(true)
    const answer = r.getFinalAnswer()!
    expect(answer).toContain("a")
    expect(answer).toContain("1")
    expect(answer).toContain("two")
  })

  test("resetFinalAnswer clears the state", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode('FINAL("first")')
    expect(r.hasFinalAnswer()).toBe(true)
    r.resetFinalAnswer()
    expect(r.hasFinalAnswer()).toBe(false)
    expect(r.getFinalAnswer()).toBeUndefined()
  })

  test("last FINAL call wins", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode('FINAL("first")')
    await r.executeCode('FINAL("second")')
    expect(r.getFinalAnswer()).toBe("second")
  })

  test("FINAL does not appear in SHOW_VARS", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode('FINAL("test")')
    const result = await r.executeCode("console.log(SHOW_VARS())")
    expect(result.stdout).not.toContain("FINAL")
    expect(result.stdout).not.toContain("__rlm_final__")
  })
})

// ============================================================
// 9. Graceful Cleanup
// ============================================================

describe("cleanup", () => {
  test("cleanup completes without error", async () => {
    const r = createREPL()
    await r.start()
    await r.executeCode("x = 1")

    // Should not throw
    await r.cleanup()
    repl = null // Prevent afterEach from double-cleaning
  })

  test("double cleanup does not throw", async () => {
    const r = createREPL()
    await r.start()
    await r.cleanup()
    await r.cleanup() // Should be safe
    repl = null
  })
})

// ============================================================
// 10. Stdout Capture Isolation
// ============================================================

describe("stdout isolation", () => {
  test("lots of console.log output does not break execution", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
for (let i = 0; i < 100; i++) {
    console.log(\`line \${i}: {"type": "result", "data": \${i}}\`)
}
`)
    expect(result.stdout).toContain("line 0:")
    expect(result.stdout).toContain("line 99:")
    expect(result.stderr).toBe("")

    // REPL should still work after
    const result2 = await r.executeCode("console.log('still working')")
    expect(result2.stdout).toBe("still working\n")
  })

  test("console.error during exec is captured in stderr", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
console.log("stdout line")
console.error("stderr line")
`)
    expect(result.stdout).toContain("stdout line")
    expect(result.stderr).toContain("stderr line")
  })
})

// ============================================================
// 11. Execution timing
// ============================================================

describe("execution timing", () => {
  test("executionTime is populated", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("x = 1 + 1")
    expect(result.executionTime).toBeGreaterThanOrEqual(0)
    expect(typeof result.executionTime).toBe("number")
  })
})

// ============================================================
// 12. Locals serialization
// ============================================================

describe("locals serialization", () => {
  test("scalar types are serialized directly", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
s = "hello"
n = 42
f = 3.14
b = true
`)
    expect(result.locals).toHaveProperty("s", "hello")
    expect(result.locals).toHaveProperty("n", 42)
    expect(result.locals).toHaveProperty("f", 3.14)
    expect(result.locals).toHaveProperty("b", true)
  })

  test("collections show type and length", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
my_list = [1, 2, 3]
my_obj = {a: 1}
`)
    expect(result.locals).toHaveProperty("my_list", "<Array length=3>")
    expect(result.locals).toHaveProperty("my_obj", "<Object keys=1>")
  })

  test("internal variables (starting with _) are excluded from locals", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("_internal = 'hidden'; visible = 'shown'")
    expect(result.locals).not.toHaveProperty("_internal")
    expect(result.locals).toHaveProperty("visible", "shown")
  })
})

// ============================================================
// 13. hoistDeclarations() unit tests
// ============================================================

describe("hoistDeclarations", () => {
  test("transforms const to bare assignment", () => {
    expect(hoistDeclarations("const x = 42")).toBe("x = 42")
  })

  test("transforms let to bare assignment", () => {
    expect(hoistDeclarations("let y = 'hello'")).toBe("y = 'hello'")
  })

  test("transforms var to bare assignment", () => {
    expect(hoistDeclarations("var z = true")).toBe("z = true")
  })

  test("transforms let without initializer", () => {
    expect(hoistDeclarations("let x")).toBe("x = undefined")
  })

  test("transforms multiple declarators", () => {
    expect(hoistDeclarations("let a = 1, b = 2")).toBe("a = 1; b = 2")
  })

  test("preserves indentation", () => {
    expect(hoistDeclarations("  const x = 42")).toBe("  x = 42")
  })

  test("transforms array destructuring", () => {
    expect(hoistDeclarations("const [a, b] = [1, 2]")).toBe("[a, b] = [1, 2]")
  })

  test("transforms object destructuring with parens", () => {
    const result = hoistDeclarations("const { a, b } = obj")
    expect(result).toBe(";({ a, b } = obj)")
  })

  test("does NOT transform inside blocks (braceDepth > 0)", () => {
    const code = `if (true) {
  const inner = 1
}`
    expect(hoistDeclarations(code)).toBe(code)
  })

  test("does NOT transform inside functions", () => {
    const code = `function f() {
  const local = 42
  return local
}`
    expect(hoistDeclarations(code)).toBe(code)
  })

  test("transforms top-level but not nested", () => {
    const code = `const top = 1
function f() {
  const inner = 2
}
const bottom = 3`
    const expected = `top = 1
function f() {
  const inner = 2
}
bottom = 3`
    expect(hoistDeclarations(code)).toBe(expected)
  })

  test("handles arrow functions with object literal values", () => {
    const result = hoistDeclarations("const fn = () => ({ x: 1 })")
    expect(result).toBe("fn = () => ({ x: 1 })")
  })

  test("handles complex expressions on the right side", () => {
    const result = hoistDeclarations("const items = [1, 2, 3].map(x => x * 2)")
    expect(result).toBe("items = [1, 2, 3].map(x => x * 2)")
  })

  test("passes through non-declaration lines unchanged", () => {
    const code = "x = 42\nconsole.log(x)"
    expect(hoistDeclarations(code)).toBe(code)
  })

  test("handles for-loop: const inside braces not transformed", () => {
    const code = `for (let i = 0; i < 10; i++) {
  const x = i * 2
  console.log(x)
}`
    // The for-line itself starts with `for`, not `const/let/var`, so it's untouched.
    // The inner `const x` is at braceDepth 1, so it's also untouched.
    expect(hoistDeclarations(code)).toBe(code)
  })

  test("handles trailing semicolons", () => {
    expect(hoistDeclarations("const x = 42;")).toBe("x = 42;")
  })
})

// ============================================================
// 14. const/let persistence in REPL
// ============================================================

describe("const/let persistence", () => {
  test("const variable persists across executeCode calls", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("const x = 42")
    const result = await r.executeCode("console.log(x)")
    expect(result.stdout).toBe("42\n")
    expect(result.locals).toHaveProperty("x", 42)
  })

  test("let variable persists across executeCode calls", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("let y = 'hello'")
    const result = await r.executeCode("console.log(y)")
    expect(result.stdout).toBe("hello\n")
  })

  test("const array destructuring persists", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("const [a, b, c] = [10, 20, 30]")
    const result = await r.executeCode("console.log(a + b + c)")
    expect(result.stdout).toBe("60\n")
  })

  test("const object destructuring persists", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode('const { name, age } = { name: "Alice", age: 30 }')
    const result = await r.executeCode("console.log(name, age)")
    expect(result.stdout).toBe("Alice 30\n")
  })

  test("multiple const declarators persist", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("const a = 1, b = 2, c = 3")
    const result = await r.executeCode("console.log(a + b + c)")
    expect(result.stdout).toBe("6\n")
  })

  test("let without initializer persists as undefined", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("let x")
    const result = await r.executeCode("console.log(x)")
    expect(result.stdout).toBe("undefined\n")
  })

  test("const inside nested block does NOT leak to scope", async () => {
    const r = createREPL()
    await r.start()

    // const inside a block should stay block-scoped (NOT hoisted)
    await r.executeCode("if (true) { const inner = 99 }")
    // inner should not be in scope — accessing it returns undefined from Proxy
    const result = await r.executeCode("console.log(typeof inner)")
    expect(result.stdout).toBe("undefined\n")
  })

  test("const function persists and is callable", async () => {
    const r = createREPL()
    await r.start()

    await r.executeCode("const double = (n) => n * 2")
    const result = await r.executeCode("console.log(double(21))")
    expect(result.stdout).toBe("42\n")
  })
})

// ============================================================
// 15. Sandbox security
// ============================================================

describe("sandbox security", () => {
  test("process is not accessible", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("console.log(typeof process)")
    expect(result.stdout).toBe("undefined\n")
  })

  test("require is not accessible", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("console.log(typeof require)")
    expect(result.stdout).toBe("undefined\n")
  })

  test("Bun is not accessible", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("console.log(typeof Bun)")
    expect(result.stdout).toBe("undefined\n")
  })

  test("module/exports are not accessible", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode("console.log(typeof module, typeof exports)")
    expect(result.stdout).toBe("undefined undefined\n")
  })

  test("import() is not available for dynamic imports", async () => {
    const r = createREPL()
    await r.start()

    // Dynamic import should fail in the sandbox
    const result = await r.executeCode('const m = await import("node:fs")')
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test("whitelisted globals ARE accessible", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
console.log(typeof Math)
console.log(typeof JSON)
console.log(typeof Array)
console.log(typeof Promise)
console.log(typeof Map)
console.log(typeof Set)
console.log(typeof RegExp)
console.log(typeof Date)
`)
    expect(result.stdout).toBe("object\nobject\nfunction\nfunction\nfunction\nfunction\nfunction\nfunction\n")
    expect(result.stderr).toBe("")
  })

  test("setTimeout works in sandbox", async () => {
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
result = await new Promise(resolve => setTimeout(() => resolve("done"), 10))
console.log(result)
`)
    expect(result.stdout).toBe("done\n")
  })
})

// ============================================================
// 16. Execution Timeout
// ============================================================

describe("Execution timeout", () => {
  test("async operation that exceeds timeout reports error in stderr", async () => {
    const r = createREPL({ executionTimeoutMs: 100 })
    await r.start()

    const result = await r.executeCode(`
await new Promise(resolve => setTimeout(resolve, 5000))
console.log("should not reach here")
`)
    expect(result.stderr).toContain("timed out")
    expect(result.stderr).toContain("100ms")
    expect(result.stdout).toBe("")
  })

  test("fast code executes within timeout", async () => {
    const r = createREPL({ executionTimeoutMs: 5000 })
    await r.start()

    const result = await r.executeCode(`
x = 42
console.log(x)
`)
    expect(result.stdout).toBe("42\n")
    expect(result.stderr).toBe("")
  })

  test("REPL remains usable after a timeout", async () => {
    const r = createREPL({ executionTimeoutMs: 100 })
    await r.start()

    // First: trigger a timeout
    const result1 = await r.executeCode(`
await new Promise(resolve => setTimeout(resolve, 5000))
`)
    expect(result1.stderr).toContain("timed out")

    // Second: normal execution should still work
    const result2 = await r.executeCode(`
y = 99
console.log(y)
`)
    expect(result2.stdout).toBe("99\n")
    expect(result2.stderr).toBe("")
  })

  test("timeout disabled with 0", async () => {
    const r = createREPL({ executionTimeoutMs: 0 })
    await r.start()

    // Should not timeout — executes a small delay successfully
    const result = await r.executeCode(`
await new Promise(resolve => setTimeout(resolve, 50))
console.log("ok")
`)
    expect(result.stdout).toBe("ok\n")
    expect(result.stderr).toBe("")
  })

  test("timeout disabled with Infinity", async () => {
    const r = createREPL({ executionTimeoutMs: Infinity })
    await r.start()

    const result = await r.executeCode(`
await new Promise(resolve => setTimeout(resolve, 50))
console.log("ok")
`)
    expect(result.stdout).toBe("ok\n")
    expect(result.stderr).toBe("")
  })

  test("default timeout is applied (30s) — fast code works", async () => {
    // Uses default timeout (30s). Fast code should complete easily.
    const r = createREPL()
    await r.start()

    const result = await r.executeCode(`
total = 0
for (let i = 0; i < 1000000; i++) total += i
console.log(total)
`)
    expect(result.stdout).toBe("499999500000\n")
    expect(result.stderr).toBe("")
  })
})

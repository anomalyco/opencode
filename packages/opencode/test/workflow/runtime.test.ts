import { describe, expect, it } from "bun:test"
import { executeScript, WorkflowRuntimeError } from "../../src/workflow/runtime"
import type { WorkflowHelpers } from "../../src/workflow/executor"

// Mock helpers for testing — these don't spawn real agents
const mockHelpers: WorkflowHelpers = {
  agent: async (params) => {
    return {
      text: `mock response to: ${params.prompt}`,
      ok: true,
      sessionID: "test-session",
    }
  },
  parallel: async (items, fn) => {
    return Promise.all(items.map(fn))
  },
  sleep: async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  },
}

describe("workflow runtime", () => {
  describe("executeScript", () => {
    it("executes a simple script that returns a value", async () => {
      const script = `return "hello world"`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBe("hello world")
    })

    it("executes a script that uses JSON", async () => {
      const script = `return JSON.stringify({ a: 1, b: 2 })`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBe(JSON.stringify({ a: 1, b: 2 }))
    })

    it("executes a script that uses Math", async () => {
      const script = `return Math.max(1, 2, 3)`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBe(3)
    })

    it("executes a script that uses Array methods", async () => {
      const script = `return [1, 2, 3].map(x => x * 2).filter(x => x > 2)`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toEqual([4, 6])
    })

    it("passes args to the script", async () => {
      const script = `return "args: " + args`
      const result = await executeScript(script, mockHelpers, "test-args")
      expect(result).toBe("args: test-args")
    })

    it("agent() helper is available and returns result", async () => {
      const script = `
const result = await agent({ prompt: "test prompt" })
return result.text
`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBe("mock response to: test prompt")
    })

    it("parallel() helper runs items in parallel", async () => {
      const script = `
const items = ["a", "b", "c"]
const results = await parallel(items, (item) => agent({ prompt: item }))
return results.map(r => r.text).join(",")
`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBe("mock response to: a,mock response to: b,mock response to: c")
    })

    it("script returning undefined returns undefined", async () => {
      const script = `// no return`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBeUndefined()
    })

    it("script can use async/await", async () => {
      const script = `
await sleep(10)
return "done"
`
      const result = await executeScript(script, mockHelpers, "")
      expect(result).toBe("done")
    })
  })

  describe("sandbox restrictions", () => {
    it("rejects require()", async () => {
      await expect(executeScript(`require("fs")`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects import statements", async () => {
      await expect(executeScript(`import fs from "fs"`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects process.* access", async () => {
      await expect(executeScript(`return process.env`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects globalThis access", async () => {
      await expect(executeScript(`return globalThis`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects eval()", async () => {
      await expect(executeScript(`eval("1+1")`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects new Function()", async () => {
      await expect(executeScript(`new Function("return 1")()`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects child_process", async () => {
      await expect(executeScript(`child_process.exec("ls")`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects __dirname", async () => {
      await expect(executeScript(`return __dirname`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects __filename", async () => {
      await expect(executeScript(`return __filename`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects fetch()", async () => {
      await expect(executeScript(`fetch("http://example.com")`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects setTimeout", async () => {
      await expect(executeScript(`setTimeout(() => {}, 100)`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects setInterval", async () => {
      await expect(executeScript(`setInterval(() => {}, 100)`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects Buffer", async () => {
      await expect(executeScript(`return Buffer.from("test")`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects Reflect", async () => {
      await expect(executeScript(`Reflect.get({}, "x")`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("rejects Proxy", async () => {
      await expect(executeScript(`new Proxy({}, {})`, mockHelpers, "")).rejects.toThrow(WorkflowRuntimeError)
    })

    it("error message includes line number for forbidden pattern", async () => {
      try {
        await executeScript(`const x = 1\nrequire("fs")`, mockHelpers, "")
        throw new Error("should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(WorkflowRuntimeError)
        expect((err as WorkflowRuntimeError).message).toContain("line 2")
      }
    })
  })
})

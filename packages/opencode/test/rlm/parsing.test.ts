import { describe, expect, test } from "bun:test"
import {
  findCodeBlocks,
  findFinalAnswer,
  findFinalAnswerAsync,
  formatIteration,
  formatExecutionResult,
} from "../../src/rlm/parsing"
import type { REPLResult, RLMIteration } from "../../src/rlm/types"

// ============================================================
// findCodeBlocks
// ============================================================

describe("findCodeBlocks", () => {
  test("extracts a single repl code block", () => {
    const text = 'Some text\n```repl\nprint("hello")\n```\nMore text'
    const blocks = findCodeBlocks(text)
    expect(blocks).toEqual(['print("hello")'])
  })

  test("extracts multiple repl code blocks", () => {
    const text = `
Here is step 1:
\`\`\`repl
x = 1
print(x)
\`\`\`

And step 2:
\`\`\`repl
y = x + 1
print(y)
\`\`\`
`
    const blocks = findCodeBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe("x = 1\nprint(x)")
    expect(blocks[1]).toBe("y = x + 1\nprint(y)")
  })

  test("ignores non-repl code blocks", () => {
    const text = '```python\nprint("not repl")\n```\n```repl\nprint("yes repl")\n```'
    const blocks = findCodeBlocks(text)
    expect(blocks).toEqual(['print("yes repl")'])
  })

  test("returns empty array when no blocks found", () => {
    const text = "Just plain text with no code blocks"
    expect(findCodeBlocks(text)).toEqual([])
  })

  test("handles empty repl block", () => {
    const text = "```repl\n\n```"
    const blocks = findCodeBlocks(text)
    expect(blocks).toEqual([""])
  })

  test("handles multi-line code with indentation", () => {
    const text = `
\`\`\`repl
def foo(x):
    return x * 2

result = foo(21)
print(result)
\`\`\`
`
    const blocks = findCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain("def foo(x):")
    expect(blocks[0]).toContain("    return x * 2")
  })
})

// ============================================================
// findFinalAnswer (sync)
// ============================================================

describe("findFinalAnswer", () => {
  test("detects FINAL() with simple string", () => {
    const text = "After analysis:\nFINAL(The answer is 42)"
    const answer = findFinalAnswer(text)
    expect(answer).toBe("The answer is 42")
  })

  test("detects FINAL() with multi-line content", () => {
    const text = `
Some reasoning here.
FINAL(Line one
Line two
Line three)
`
    const answer = findFinalAnswer(text)
    expect(answer).toBe("Line one\nLine two\nLine three")
  })

  test("detects FINAL() with nested parentheses", () => {
    const text = "FINAL(f(x) = (x+1)*(x-1))"
    const answer = findFinalAnswer(text)
    // Greedy matching should capture everything
    expect(answer).toBe("f(x) = (x+1)*(x-1)")
  })

  test("detects FINAL_VAR() with executeCode callback", () => {
    const mockResult: REPLResult = {
      stdout: "the stored answer\n",
      stderr: "",
      locals: {},
      executionTime: 0,
      rlmCalls: [],
    }
    const text = 'FINAL_VAR("my_answer")'
    const answer = findFinalAnswer(text, () => mockResult)
    expect(answer).toBe("the stored answer")
  })

  test("FINAL_VAR without executeCode returns undefined", () => {
    const text = 'FINAL_VAR("my_answer")'
    const answer = findFinalAnswer(text)
    expect(answer).toBeUndefined()
  })

  test("returns undefined when no FINAL pattern found", () => {
    const text = "Just some regular text without any final answer"
    const answer = findFinalAnswer(text)
    expect(answer).toBeUndefined()
  })

  test("FINAL() at start of line matches", () => {
    const text = "prefix text\nFINAL(answer here)"
    const answer = findFinalAnswer(text)
    expect(answer).toBe("answer here")
  })

  test("FINAL() with leading whitespace matches", () => {
    const text = "  FINAL(indented answer)"
    const answer = findFinalAnswer(text)
    expect(answer).toBe("indented answer")
  })

  test("FINAL_VAR takes priority over FINAL", () => {
    const mockResult: REPLResult = {
      stdout: "var value\n",
      stderr: "",
      locals: {},
      executionTime: 0,
      rlmCalls: [],
    }
    const text = 'FINAL_VAR("x")\nFINAL(some text)'
    const answer = findFinalAnswer(text, () => mockResult)
    expect(answer).toBe("var value")
  })

  test("FINAL_VAR strips quotes from variable name", () => {
    const mockResult: REPLResult = {
      stdout: "42\n",
      stderr: "",
      locals: {},
      executionTime: 0,
      rlmCalls: [],
    }
    // Test with double quotes
    expect(findFinalAnswer('FINAL_VAR("answer")', () => mockResult)).toBe("42")
    // Test with single quotes
    expect(findFinalAnswer("FINAL_VAR('answer')", () => mockResult)).toBe("42")
  })
})

// ============================================================
// findFinalAnswerAsync
// ============================================================

describe("findFinalAnswerAsync", () => {
  test("async FINAL_VAR executes code and returns result", async () => {
    const text = 'FINAL_VAR("result")'
    const answer = await findFinalAnswerAsync(text, async (code) => ({
      stdout: "async answer\n",
      stderr: "",
      locals: {},
      executionTime: 0,
      rlmCalls: [],
    }))
    expect(answer).toBe("async answer")
  })

  test("async FINAL() returns directly without executing", async () => {
    let executed = false
    const text = "FINAL(direct answer)"
    const answer = await findFinalAnswerAsync(text, async () => {
      executed = true
      return { stdout: "", stderr: "", locals: {}, executionTime: 0, rlmCalls: [] }
    })
    expect(answer).toBe("direct answer")
    expect(executed).toBe(false)
  })

  test("async returns undefined when no pattern", async () => {
    const answer = await findFinalAnswerAsync("no patterns here")
    expect(answer).toBeUndefined()
  })
})

// ============================================================
// formatExecutionResult
// ============================================================

describe("formatExecutionResult", () => {
  test("formats stdout", () => {
    const result: REPLResult = {
      stdout: "hello world",
      stderr: "",
      locals: {},
      executionTime: 0.1,
      rlmCalls: [],
    }
    const formatted = formatExecutionResult(result)
    expect(formatted).toContain("hello world")
  })

  test("formats stderr", () => {
    const result: REPLResult = {
      stdout: "",
      stderr: "NameError: name 'x' is not defined",
      locals: {},
      executionTime: 0.1,
      rlmCalls: [],
    }
    const formatted = formatExecutionResult(result)
    expect(formatted).toContain("NameError")
  })

  test("shows REPL variables", () => {
    const result: REPLResult = {
      stdout: "",
      stderr: "",
      locals: { x: 42, name: "test", items: [1, 2, 3] },
      executionTime: 0.1,
      rlmCalls: [],
    }
    const formatted = formatExecutionResult(result)
    expect(formatted).toContain("x")
    expect(formatted).toContain("name")
    expect(formatted).toContain("items")
  })

  test("returns 'No output' for empty result", () => {
    const result: REPLResult = {
      stdout: "",
      stderr: "",
      locals: {},
      executionTime: 0.1,
      rlmCalls: [],
    }
    const formatted = formatExecutionResult(result)
    expect(formatted).toBe("No output")
  })

  test("excludes internal variables", () => {
    const result: REPLResult = {
      stdout: "",
      stderr: "",
      locals: { __builtins__: {}, __name__: "__main__", visible: 1 },
      executionTime: 0.1,
      rlmCalls: [],
    }
    const formatted = formatExecutionResult(result)
    expect(formatted).toContain("visible")
    expect(formatted).not.toContain("__builtins__")
    expect(formatted).not.toContain("__name__")
  })
})

// ============================================================
// formatIteration
// ============================================================

describe("formatIteration", () => {
  test("formats iteration with response and code blocks", () => {
    const iteration: RLMIteration = {
      prompt: [],
      response: "Let me compute this.",
      codeBlocks: [
        {
          code: "x = 2 + 2\nprint(x)",
          result: {
            stdout: "4\n",
            stderr: "",
            locals: { x: 4 },
            executionTime: 0.01,
            rlmCalls: [],
          },
        },
      ],
    }

    const messages = formatIteration(iteration)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("assistant")
    expect(messages[0].content).toBe("Let me compute this.")
    expect(messages[1].role).toBe("user")
    expect(messages[1].content).toContain("x = 2 + 2")
    expect(messages[1].content).toContain("4")
  })

  test("formats iteration with no code blocks", () => {
    const iteration: RLMIteration = {
      prompt: [],
      response: "Just thinking out loud.",
      codeBlocks: [],
    }

    const messages = formatIteration(iteration)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe("assistant")
    expect(messages[0].content).toBe("Just thinking out loud.")
  })

  test("truncates long execution results", () => {
    const longOutput = "x".repeat(30000)
    const iteration: RLMIteration = {
      prompt: [],
      response: "Running big computation.",
      codeBlocks: [
        {
          code: "print('x' * 30000)",
          result: {
            stdout: longOutput,
            stderr: "",
            locals: {},
            executionTime: 0.5,
            rlmCalls: [],
          },
        },
      ],
    }

    const messages = formatIteration(iteration, 20000)
    expect(messages).toHaveLength(2)
    expect(messages[1].content.length).toBeLessThan(longOutput.length + 500)
    expect(messages[1].content).toContain("chars...")
  })

  test("formats multiple code blocks in order", () => {
    const iteration: RLMIteration = {
      prompt: [],
      response: "Two steps.",
      codeBlocks: [
        {
          code: "a = 1",
          result: { stdout: "", stderr: "", locals: { a: 1 }, executionTime: 0, rlmCalls: [] },
        },
        {
          code: "b = 2",
          result: { stdout: "", stderr: "", locals: { a: 1, b: 2 }, executionTime: 0, rlmCalls: [] },
        },
      ],
    }

    const messages = formatIteration(iteration)
    expect(messages).toHaveLength(3)
    expect(messages[1].content).toContain("a = 1")
    expect(messages[2].content).toContain("b = 2")
  })
})

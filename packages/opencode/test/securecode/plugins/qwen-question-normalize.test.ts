import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  QwenQuestionNormalizePlugin,
  normalizeQuestionsInput,
} from "../../../src/securecode/plugins/qwen-question-normalize"

const stubPluginInput = {} as Parameters<typeof QwenQuestionNormalizePlugin>[0]
const DISABLE_ENV = "SECURECODE_QWEN_QUESTION_NORMALIZE_DISABLE"

const baseInput = (tool: string) => ({
  tool,
  sessionID: "ses_test",
  callID: "call_test",
})

const baseOutput = (questions: unknown) => ({ args: { questions } })

beforeEach(() => {
  delete process.env[DISABLE_ENV]
})

afterEach(() => {
  delete process.env[DISABLE_ENV]
})

describe("normalizeQuestionsInput", () => {
  test("passes through a properly-shaped array of prompts", () => {
    const input = [{ question: "Pick one", header: "Pick", options: [{ label: "a", description: "desc" }] }]
    const result = normalizeQuestionsInput(input) as Array<{ question: string; header: string; options: unknown[] }>
    expect(result.length).toBe(1)
    expect(result[0].question).toBe("Pick one")
    expect(result[0].options).toEqual([{ label: "a", description: "desc" }])
  })

  // Issue #100: surrounding-newlines + JSON string + options:[]
  test("normalizes Qwen-style stringified JSON with options:[] (#100)", () => {
    const input = '\n[{"question": "実装言語は？", "header": "実装言語", "options": [], "multiple": false}]\n'
    const result = normalizeQuestionsInput(input) as Array<{ question: string; header: string; options: unknown[] }>
    expect(result.length).toBe(1)
    expect(result[0].question).toBe("実装言語は？")
    expect(result[0].header).toBe("実装言語")
    expect(result[0].options).toEqual([])
  })

  test("normalizes a stringified JSON array with rich options", () => {
    const input =
      '[{"question": "lang?", "header": "Lang", "options": [{"label": "TS", "description": "ts"}, {"label": "Go", "description": "go"}]}]'
    const result = normalizeQuestionsInput(input) as Array<{ options: Array<{ label: string }> }>
    expect(result.length).toBe(1)
    expect(result[0].options.map((o) => o.label)).toEqual(["TS", "Go"])
  })

  test("wraps a single question object into an array", () => {
    const input = { question: "Pick", header: "Pick", options: [{ label: "a", description: "desc" }] }
    const result = normalizeQuestionsInput(input) as Array<{ question: string }>
    expect(result.length).toBe(1)
    expect(result[0].question).toBe("Pick")
  })

  test("converts a plain string into a free-form question", () => {
    const result = normalizeQuestionsInput("Which language do you prefer?") as Array<{
      question: string
      options: unknown[]
    }>
    expect(result.length).toBe(1)
    expect(result[0].question).toBe("Which language do you prefer?")
    expect(result[0].options).toEqual([])
  })

  test("returns the original value when input is non-recoverable garbage", () => {
    expect(normalizeQuestionsInput(42)).toBe(42)
    expect(normalizeQuestionsInput(null)).toBe(null)
    expect(normalizeQuestionsInput("")).toBe("")
  })

  test("filters out array elements that have no usable question text", () => {
    const input = [
      { question: "Pick", header: "Pick", options: [] },
      { foo: "bar" }, // no question/header → dropped
      { question: "  ", options: [] }, // whitespace-only → dropped
    ]
    const result = normalizeQuestionsInput(input) as Array<{ question: string }>
    expect(result.length).toBe(1)
    expect(result[0].question).toBe("Pick")
  })

  test("preserves multiple flag when explicitly true, omits otherwise", () => {
    const withTrue = normalizeQuestionsInput([{ question: "q", header: "h", options: [], multiple: true }]) as Array<{
      multiple?: boolean
    }>
    expect(withTrue[0].multiple).toBe(true)

    const withFalse = normalizeQuestionsInput([
      { question: "q", header: "h", options: [], multiple: false },
    ]) as Array<{ multiple?: boolean }>
    expect("multiple" in withFalse[0]).toBe(false)
  })
})

describe("QwenQuestionNormalizePlugin tool.execute.before hook", () => {
  test("only fires for the question tool", async () => {
    const hooks = await QwenQuestionNormalizePlugin(stubPluginInput)
    const before = hooks["tool.execute.before"]!
    const output = baseOutput("not normalized — wrong tool")
    await before(baseInput("read") as any, output as any)
    expect(output.args.questions).toBe("not normalized — wrong tool")
  })

  test("normalizes stringified questions in-place", async () => {
    const hooks = await QwenQuestionNormalizePlugin(stubPluginInput)
    const before = hooks["tool.execute.before"]!
    const stringified =
      '\n[{"question": "lang?", "header": "Lang", "options": [{"label": "TS", "description": "ts"}]}]\n'
    const output = baseOutput(stringified)
    await before(baseInput("question") as any, output as any)
    expect(Array.isArray(output.args.questions)).toBe(true)
    const arr = output.args.questions as Array<{ question: string }>
    expect(arr[0].question).toBe("lang?")
  })

  test("leaves a properly-shaped array untouched", async () => {
    const hooks = await QwenQuestionNormalizePlugin(stubPluginInput)
    const before = hooks["tool.execute.before"]!
    const arr = [{ question: "q", header: "h", options: [{ label: "a", description: "desc" }] }]
    const output = baseOutput(arr)
    await before(baseInput("question") as any, output as any)
    // normalize is idempotent; the reference may change but the content stays equivalent.
    expect(Array.isArray(output.args.questions)).toBe(true)
    expect((output.args.questions as Array<{ question: string }>)[0].question).toBe("q")
  })

  test("no-ops when args.questions is missing", async () => {
    const hooks = await QwenQuestionNormalizePlugin(stubPluginInput)
    const before = hooks["tool.execute.before"]!
    const output = { args: {} } as any
    await before(baseInput("question") as any, output)
    expect(output.args).toEqual({})
  })

  test("returns no hooks when SECURECODE_QWEN_QUESTION_NORMALIZE_DISABLE=1", async () => {
    process.env[DISABLE_ENV] = "1"
    const hooks = await QwenQuestionNormalizePlugin(stubPluginInput)
    expect(hooks["tool.execute.before"]).toBeUndefined()
  })
})

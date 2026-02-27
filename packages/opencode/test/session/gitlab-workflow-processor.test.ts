import { describe, expect, test } from "bun:test"

describe("processor tool-error handling", () => {
  test("string errors are passed through", () => {
    const error: unknown = "something went wrong"
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe("something went wrong")
  })

  test("Error instances extract message", () => {
    const error: unknown = new Error("test error message")
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe("test error message")
  })

  test("object with output property uses output.toString()", () => {
    const error: unknown = { output: "tool output error", code: 1 }
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe("tool output error")
  })

  test("object with message property uses message.toString()", () => {
    const error: unknown = { message: "error from tool", details: {} }
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe("error from tool")
  })

  test("object without output/message falls back to JSON.stringify", () => {
    const error: unknown = { code: 42, type: "custom" }
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe('{"code":42,"type":"custom"}')
  })

  test("non-string non-object falls back to String()", () => {
    const error: unknown = 404
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe("404")
  })

  test("null falls back to String()", () => {
    const error: unknown = null
    const result =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).output?.toString() ||
              (error as Record<string, unknown>).message?.toString() ||
              JSON.stringify(error)
            : String(error)
    expect(result).toBe("null")
  })
})

describe("processor finish event guard", () => {
  test("finish with usage and no prior finish updates message", () => {
    const message = { finish: undefined as string | undefined, cost: 0, tokens: { input: 0, output: 0, cache: 0 } }
    const totalUsage = { promptTokens: 100, completionTokens: 50 }
    const finishReason = "stop"

    if (totalUsage && !message.finish) {
      message.finish = finishReason
      message.cost += 0.001
      message.tokens = { input: totalUsage.promptTokens, output: totalUsage.completionTokens, cache: 0 }
    }

    expect(message.finish).toBe("stop")
    expect(message.cost).toBe(0.001)
    expect(message.tokens.input).toBe(100)
    expect(message.tokens.output).toBe(50)
  })

  test("finish skipped when message already has finish reason", () => {
    const message = {
      finish: "stop" as string | undefined,
      cost: 0.005,
      tokens: { input: 200, output: 100, cache: 0 },
    }
    const totalUsage = { promptTokens: 999, completionTokens: 999 }
    const finishReason = "stop"

    if (totalUsage && !message.finish) {
      message.finish = finishReason
      message.cost += 0.999
      message.tokens = { input: totalUsage.promptTokens, output: totalUsage.completionTokens, cache: 0 }
    }

    expect(message.cost).toBe(0.005)
    expect(message.tokens.input).toBe(200)
    expect(message.tokens.output).toBe(100)
  })

  test("finish skipped when totalUsage is falsy", () => {
    const message = { finish: undefined as string | undefined, cost: 0, tokens: { input: 0, output: 0, cache: 0 } }
    const totalUsage = undefined

    if (totalUsage && !message.finish) {
      message.finish = "stop"
      message.cost += 0.999
    }

    expect(message.finish).toBeUndefined()
    expect(message.cost).toBe(0)
  })
})

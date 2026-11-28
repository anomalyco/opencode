import { describe, expect, test } from "bun:test"
import {
  classifyServerFunctionError,
  serverFunctionErrorResponse,
  serverFunctionErrors,
} from "../src/lib/server-function"

const invoke = (url: string, next: () => Promise<Response>) =>
  // SAFETY: serverFunctionErrors only reads event.req.url before delegating to next().
  serverFunctionErrors({ req: new Request(url) } as Parameters<typeof serverFunctionErrors>[0], next)

function expectErrorResponse(value: unknown, status: number) {
  expect(value).toBeInstanceOf(Response)
  if (!(value instanceof Response)) throw new Error("expected Response")
  expect(value.status).toBe(status)
  expect(value.headers.get("cache-control")).toBe("no-store")
  expect(value.headers.get("x-error")).toBe("true")
}

describe("classifyServerFunctionError", () => {
  test("classifies SolidStart client dispatch errors into a closed union", () => {
    expect(classifyServerFunctionError(new Error("invalid server function: 8e4f7517-da762c1a"))).toEqual({
      kind: "retired_function",
    })
    expect(
      classifyServerFunctionError(
        new Error("Server function stream chunk of 99999999 bytes is larger than the limit of 67108864 bytes."),
      ),
    ).toEqual({ kind: "payload_too_large" })
    expect(classifyServerFunctionError(new Error("Seroval Error (step: 3)"))).toEqual({
      kind: "malformed_request",
    })
    expect(classifyServerFunctionError(new Error("database connection reset"))).toEqual({
      kind: "unexpected",
    })
    expect(classifyServerFunctionError("not an error")).toEqual({ kind: "unexpected" })
  })
})

describe("serverFunctionErrors", () => {
  test("answers retired or unknown server function ids with 410", async () => {
    const urls = [
      "https://opencode.ai/data/_server?id=8e4f7517-da762c1a",
      "https://opencode.ai/data/_server/subscription.get",
    ]
    await Promise.all(
      urls.map(async (url) => {
        const response = await invoke(url, async () => {
          throw new Error("invalid server function: 8e4f7517-da762c1a")
        })
        expectErrorResponse(response, 410)
      }),
    )
  })

  test("answers malformed server function streams and Seroval deserialization errors with 400", async () => {
    const errors = [
      new Error("Malformed server function stream."),
      new Error("Seroval Error (step: 3)"),
      new Error("Seroval Error (specific: 8)"),
      new Error("missing body"),
      new SyntaxError("Unexpected end of JSON input"),
      new TypeError("result is not iterable"),
      new TypeError("Could not parse content as FormData."),
      new TypeError("No initial boundary string (or you have a truncated message)."),
    ]

    await Promise.all(
      errors.map(async (error) => {
        const response = await invoke("https://opencode.ai/data/_server", async () => {
          throw error
        })
        expectErrorResponse(response, 400)
      }),
    )
  })

  test("answers oversized server function stream chunks with 413", async () => {
    const response = await invoke("https://opencode.ai/data/_server", async () => {
      throw new Error("Server function stream chunk of 99999999 bytes is larger than the limit of 67108864 bytes.")
    })

    expectErrorResponse(response, 413)
  })

  test("rethrows unexpected internal errors on /data/_server and leaves other routes untouched", async () => {
    await expect(
      invoke("https://opencode.ai/data/_server", async () => {
        throw new Error("database connection reset")
      }),
    ).rejects.toThrow("database connection reset")

    await expect(
      invoke("https://opencode.ai/data/alibaba/qwen-3", async () => {
        throw new Error("invalid server function: should-not-be-caught-here")
      }),
    ).rejects.toThrow("invalid server function: should-not-be-caught-here")

    await expect(
      invoke("https://opencode.ai/data/_server-other", async () => {
        throw new Error("invalid server function: should-not-be-caught-here")
      }),
    ).rejects.toThrow("invalid server function: should-not-be-caught-here")

    expect(serverFunctionErrorResponse("not an error")).toBeUndefined()
  })
})

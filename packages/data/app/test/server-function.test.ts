import { describe, expect, test } from "bun:test"
import { serverFunctionErrorResponse, serverFunctionErrors } from "../src/lib/server-function"

const invoke = (url: string, next: () => Promise<unknown>) =>
  serverFunctionErrors({ req: new Request(url) } as Parameters<typeof serverFunctionErrors>[0], next)

describe("serverFunctionErrors", () => {
  test("answers retired or unknown server function ids with 410", async () => {
    const response = await invoke("https://opencode.ai/data/_server?id=8e4f7517-da762c1a", async () => {
      throw new Error("invalid server function: 8e4f7517-da762c1a")
    })

    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(410)
    expect((response as Response).headers.get("cache-control")).toBe("no-store")
    expect((response as Response).headers.get("x-error")).toBe("true")
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

    for (const error of errors) {
      const response = await invoke("https://opencode.ai/data/_server", async () => {
        throw error
      })
      expect(response).toBeInstanceOf(Response)
      expect((response as Response).status).toBe(400)
      expect((response as Response).headers.get("cache-control")).toBe("no-store")
      expect((response as Response).headers.get("x-error")).toBe("true")
    }
  })

  test("answers oversized server function stream chunks with 413", async () => {
    const response = await invoke("https://opencode.ai/data/_server", async () => {
      throw new Error("Server function stream chunk of 99999999 bytes is larger than the limit of 67108864 bytes.")
    })

    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(413)
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

    expect(serverFunctionErrorResponse("not an error")).toBeUndefined()
  })
})

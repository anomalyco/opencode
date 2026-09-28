import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { rawRequest, resolveBody, resolveOperation } from "./api"

describe("api request resolution", () => {
  test("resolves an operation ID with path and query parameters", () => {
    expect(
      resolveOperation(
        {
          paths: {
            "/api/session/{sessionID}": {
              get: { operationId: "session.get" },
            },
          },
        },
        "session.get",
        { sessionID: "ses/a", workspace: "work" },
      ),
    ).toEqual({ method: "GET", path: "/api/session/ses%2Fa?workspace=work" })
  })

  test("rejects a missing path parameter", () => {
    expect(() =>
      resolveOperation(
        { paths: { "/api/session/{sessionID}": { get: { operationId: "session.get" } } } },
        "session.get",
        {},
      ),
    ).toThrow("Missing path parameter: sessionID")
  })

  test("resolves curl-like method and path input", () => {
    expect(rawRequest(["post", "/api/foo"])).toEqual({ method: "POST", path: "/api/foo" })
    expect(rawRequest(["session.list"])).toBeUndefined()
  })
})

describe("api body sources", () => {
  test("uses an inline body unchanged", async () => {
    const body = `{"directory":"D:\\a folder with spaces\\project"}`
    expect(await Effect.runPromise(resolveBody(body))).toBe(body)
    expect(await Effect.runPromise(resolveBody(undefined))).toBeUndefined()
  })

  test("reads the body from a file after @", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-api-body-"))
    const body = `{"directory":"D:\\a folder with spaces"}`
    try {
      const file = join(directory, "body.json")
      await writeFile(file, body)
      expect(await Effect.runPromise(resolveBody(`@${file}`))).toBe(body)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("reports a body file that cannot be read", async () => {
    const failure = await Effect.runPromise(Effect.flip(resolveBody("@/nonexistent/opencode-body.json")))
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain("Failed to read request body")
  })

  test("rejects a bare @", async () => {
    const failure = await Effect.runPromise(Effect.flip(resolveBody("@")))
    expect(String(failure)).toContain("Expected a file path after @, or @- to read the request body from stdin")
  })

  test("reads the body from stdin for @-", async () => {
    const stdin = process.stdin
    const body = `{"directory":"D:\\a folder with spaces"}`
    Object.defineProperty(process, "stdin", { value: Readable.from([body]), configurable: true, writable: true })
    try {
      expect(await Effect.runPromise(resolveBody("@-"))).toBe(body)
    } finally {
      Object.defineProperty(process, "stdin", { value: stdin, configurable: true, writable: true })
    }
  })
})

import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { Daemon } from "../../services/daemon"
import api, { rawRequest, resolveBody, resolveOperation } from "./api"

describe("api request resolution", () => {
  test("resolves an operation ID with path and query parameters", () => {
    expect(
      resolveOperation(
        {
          paths: {
            "/api/session/{sessionID}": {
              get: { operationId: "v2.session.get" },
            },
          },
        },
        "v2.session.get",
        { sessionID: "ses/a", workspace: "work" },
      ),
    ).toEqual({ method: "GET", path: "/api/session/ses%2Fa?workspace=work" })
  })

  test("rejects a missing path parameter", () => {
    expect(() =>
      resolveOperation(
        { paths: { "/api/session/{sessionID}": { get: { operationId: "v2.session.get" } } } },
        "v2.session.get",
        {},
      ),
    ).toThrow("Missing path parameter: sessionID")
  })

  test("resolves curl-like method and path input", () => {
    expect(rawRequest(["post", "/api/foo"])).toEqual({ method: "POST", path: "/api/foo" })
    expect(rawRequest(["v2.session.list"])).toBeUndefined()
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

describe("api command", () => {
  test("sends a body read from a file to the server", async () => {
    const sent: Array<string | undefined> = []
    const contentTypes: Array<string | null> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        sent.push(await request.text())
        contentTypes.push(request.headers.get("content-type"))
        return new Response(null, { status: 204 })
      },
    })
    const directory = await mkdtemp(join(tmpdir(), "opencode-api-post-"))
    const body = `{"directory":"D:\\a folder with spaces"}`
    try {
      const file = join(directory, "body.json")
      await writeFile(file, body)
      const unused = Effect.die(new Error("unused in this test"))
      const daemon = Layer.succeed(Daemon.Service)({
        transport: () => Effect.succeed({ url: server.url.origin, headers: {} }),
        client: () => unused,
        start: () => unused,
        status: () => unused,
        stop: () => unused,
        password: () => unused,
        register: () => unused,
      })
      await Effect.runPromise(
        api({ request: ["post", "/api/echo"], data: Option.some(`@${file}`), header: [], param: Option.none() }).pipe(
          Effect.provide(daemon),
        ),
      )
      expect(sent).toEqual([body])
      expect(contentTypes).toEqual(["application/json"])
    } finally {
      await server.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  })
})

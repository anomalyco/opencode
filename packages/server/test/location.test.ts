import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { OpenCode } from "@opencode/client"
import { AbsolutePath } from "@opencode/schema/schema"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { requestRef } from "../src/location"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  config: { project: false },
  models: { fetch: false },
  fs: { filewatcher: false },
} as const

const foreign =
  process.platform === "win32"
    ? ["/tmp/repo"]
    : ["C:\\Work\\Repo", "C:/Work/Repo", "\\\\server\\share\\repo", "//server/share/repo"]

test.each(["query", "header"] as const)("requestRef decodes the %s directory once", (source) => {
  const directory = path.join(process.cwd(), "repo%23name")
  const url = new URL("http://opencode.local/api/location")
  if (source === "query") url.searchParams.set("location[directory]", directory)
  const request = new Request(url, {
    headers: source === "header" ? { "x-opencode-directory": encodeURIComponent(directory) } : undefined,
  })
  expect(requestRef(HttpServerRequest.fromWeb(request))).toEqual({ directory: AbsolutePath.make(directory) })
})

test("requestRef retains malformed percent header fallback", () => {
  const directory = path.join(process.cwd(), "repo%name")
  expect(
    requestRef(
      HttpServerRequest.fromWeb(
        new Request("http://opencode.local/api/location", {
          headers: { "x-opencode-directory": directory },
        }),
      ),
    ),
  ).toEqual({ directory: AbsolutePath.make(directory) })
})

if (process.platform !== "win32") {
  test("requestRef preserves POSIX literal backslashes", () => {
    const directory = "/tmp/literal\\slash"
    const url = new URL("http://opencode.local/api/location")
    url.searchParams.set("location[directory]", directory)
    expect(requestRef(HttpServerRequest.fromWeb(new Request(url)))).toEqual({ directory: AbsolutePath.make(directory) })
  })
}

test("requestRef keeps relative paths and empty query fallback", () => {
  expect(
    requestRef(
      HttpServerRequest.fromWeb(new Request("http://opencode.local/api/location?location[directory]=../repo")),
    ),
  ).toEqual({ directory: AbsolutePath.make("../repo") })
  expect(
    requestRef(
      HttpServerRequest.fromWeb(
        new Request("http://opencode.local/api/location?location[directory]=", {
          headers: { "x-opencode-directory": "../repo" },
        }),
      ),
    ),
  ).toEqual({ directory: AbsolutePath.make("../repo") })
  expect(
    requestRef(HttpServerRequest.fromWeb(new Request("http://opencode.local/api/location?location[directory]="))),
  ).toEqual({ directory: AbsolutePath.make(process.cwd()) })
})

test.each(["query", "header"] as const)("requestRef reports the %s boundary for invalid directories", (source) => {
  const url = new URL("http://opencode.local/api/location")
  if (source === "query") url.searchParams.set("location[directory]", foreign[0])
  const ref = requestRef(
    HttpServerRequest.fromWeb(
      new Request(url, {
        headers: source === "header" ? { "x-opencode-directory": encodeURIComponent(foreign[0]) } : undefined,
      }),
    ),
  )
  expect(ref).toBeInstanceOf(InvalidRequestError)
  expect(ref).toMatchObject({ kind: source === "query" ? "Query" : "Header", field: "location[directory]" })
})

it.live("rejects foreign directories before all request-based location lookups", () =>
  Effect.gen(function* () {
    const config = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-directory-boundary-")))
    const handler = yield* ServerFetch.make({ ...options, config: { directory: config.path, project: false } })
    for (const endpoint of [
      "/api/location",
      "/api/session/global/form",
      "/api/debug/location",
      "/api/pty/pty_missing/connect",
      "/api/experimental/client-mcp?name=boundary-test",
    ]) {
      for (const directory of foreign) {
        for (const source of ["query", "header"] as const) {
          const url = new URL(endpoint, "http://opencode.local")
          if (source === "query") url.searchParams.set("location[directory]", directory)
          const response = yield* Effect.promise(() =>
            handler(
              new Request(url, {
                method: endpoint === "/api/debug/location" ? "DELETE" : "GET",
                headers: source === "header" ? { "x-opencode-directory": encodeURIComponent(directory) } : undefined,
              }),
            ),
          )
          expect({ endpoint, source, directory, status: response.status }).toEqual({
            endpoint,
            source,
            directory,
            status: 400,
          })
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            _tag: "InvalidRequestError",
            kind: source === "query" ? "Query" : "Header",
            field: "location[directory]",
          })
        }
      }
    }
    const loaded = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/debug/location")))
    expect(yield* Effect.promise(() => loaded.json())).toEqual([])
  }),
)

it.live("preserves native directories and query precedence through the HTTP API", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-directory-transport-")))
    const directories = [path.join(tmp.path, "repo%23name"), path.join(tmp.path, "repo%name")]
    yield* Effect.promise(() => Promise.all(directories.map((directory) => fs.mkdir(directory))))
    const handler = yield* ServerFetch.make({ ...options, config: { directory: tmp.path, project: false } })
    for (const directory of directories) {
      const sources = directory.endsWith("repo%name")
        ? (["query", "header", "raw-header"] as const)
        : (["query", "header"] as const)
      for (const source of sources) {
        const url = new URL("http://opencode.local/api/location")
        if (source === "query") url.searchParams.set("location[directory]", directory)
        const response = yield* Effect.promise(() =>
          handler(
            new Request(url, {
              headers: {
                "x-opencode-directory":
                  source === "query"
                    ? encodeURIComponent(foreign[0])
                    : source === "header"
                      ? encodeURIComponent(directory)
                      : directory,
              },
            }),
          ),
        )
        expect({ directory, source, status: response.status }).toEqual({ directory, source, status: 200 })
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ directory })
      }
    }
    const relative = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/location?location[directory]=../server")),
    )
    expect(relative.status).toBe(200)
    expect(yield* Effect.promise(() => relative.json())).toMatchObject({ directory: "../server" })
  }),
)

it.live("exposes the directory boundary error through the generated SDK", () =>
  Effect.gen(function* () {
    const config = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-directory-sdk-")))
    const handler = yield* ServerFetch.make({ ...options, config: { directory: config.path, project: false } })
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(
        (input: RequestInfo | URL, init?: RequestInit) =>
          handler(input instanceof Request ? input : new Request(input, init)),
        { preconnect: fetch.preconnect },
      ),
    })
    yield* Effect.promise(async () => {
      await expect(api.location.get({ location: { directory: foreign[0] } })).rejects.toMatchObject({
        _tag: "InvalidRequestError",
        kind: "Query",
        field: "location[directory]",
      })
    })
  }),
)

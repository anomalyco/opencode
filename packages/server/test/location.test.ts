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

const invalid = process.platform === "win32" ? "C:Work\\Repo" : "C:\\Work\\Repo"

function request(directory: string, source: "query" | "header", endpoint = "/api/location") {
  const url = new URL(endpoint, "http://opencode.local")
  if (source === "query") url.searchParams.set("location[directory]", directory)
  return new Request(url, {
    method: endpoint === "/api/debug/location" ? "DELETE" : "GET",
    headers: source === "header" ? { "x-opencode-directory": encodeURIComponent(directory) } : undefined,
  })
}

test.each(["query", "header"] as const)("requestRef preserves %s directory spelling after one decode", (source) => {
  const directories = [
    path.join(process.cwd(), "repo%23name"),
    ...(process.platform === "win32"
      ? [
          "C:/Work/Repo",
          "c:\\Work\\Repo",
          "\\\\server\\share\\repo",
          "//server/share/repo",
          "/Work/Repo",
          "\\Work\\Repo",
        ]
      : ["//tmp", "//tmp/repo", "///tmp/repo", "//server/share/repo", "/tmp/literal\\slash"]),
  ]
  for (const directory of directories) {
    expect(requestRef(HttpServerRequest.fromWeb(request(directory, source)))).toEqual({
      directory: AbsolutePath.make(directory),
    })
  }
})

test("requestRef preserves query precedence, relative paths and header decoding fallbacks", () => {
  const query = request("../repo", "query")
  query.headers.set("x-opencode-directory", invalid)
  expect(requestRef(HttpServerRequest.fromWeb(query))).toEqual({ directory: AbsolutePath.make("../repo") })
  for (const directory of ["../repo", path.join(process.cwd(), "repo%name")]) {
    const fallback = new Request("http://opencode.local/api/location?location[directory]=", {
      headers: { "x-opencode-directory": directory },
    })
    expect(requestRef(HttpServerRequest.fromWeb(fallback))).toEqual({ directory: AbsolutePath.make(directory) })
  }
  expect(requestRef(HttpServerRequest.fromWeb(request("", "query")))).toEqual({
    directory: AbsolutePath.make(process.cwd()),
  })
})

test.each(["query", "header"] as const)("requestRef reports invalid %s directory hints", (source) => {
  for (const directory of [invalid, "/tmp/\0repo"]) {
    const ref = requestRef(HttpServerRequest.fromWeb(request(directory, source)))
    expect(ref).toBeInstanceOf(InvalidRequestError)
    expect(ref).toMatchObject({ kind: source === "query" ? "Query" : "Header", field: "location[directory]" })
  }
})

it.live("validates each location entry point and preserves native HTTP/SDK behavior", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-directory-boundary-")))
    const handler = yield* ServerFetch.make({
      app: { version: "test-version" },
      database: { path: ":memory:" },
      config: { directory: tmp.path, project: false, content: "{}" },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    for (const endpoint of [
      "/api/location",
      "/api/session/global/form",
      "/api/debug/location",
      "/api/pty/pty_missing/connect",
      "/api/experimental/client-mcp?name=boundary-test",
    ]) {
      for (const source of ["query", "header"] as const) {
        const response = yield* Effect.promise(() => handler(request(invalid, source, endpoint)))
        expect({ endpoint, source, status: response.status }).toEqual({ endpoint, source, status: 400 })
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          _tag: "InvalidRequestError",
          kind: source === "query" ? "Query" : "Header",
          field: "location[directory]",
        })
      }
    }
    const loaded = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/debug/location")))
    expect(yield* Effect.promise(() => loaded.json())).toEqual([])

    const directory = path.join(tmp.path, "repo%23name")
    yield* Effect.promise(() => fs.mkdir(directory))
    const spellings =
      process.platform === "win32"
        ? [
            directory,
            directory.replaceAll("\\", "/"),
            process
              .cwd()
              .replace(/^[A-Za-z]:/, "")
              .replaceAll("\\", "/"),
          ]
        : [directory, `/${directory}`, `//${directory}`]
    for (const spelling of spellings) {
      for (const source of ["query", "header"] as const) {
        const response = yield* Effect.promise(() => handler(request(spelling, source)))
        expect({ spelling, source, status: response.status }).toEqual({ spelling, source, status: 200 })
      }
    }
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(
        (input: RequestInfo | URL, init?: RequestInit) =>
          handler(input instanceof Request ? input : new Request(input, init)),
        { preconnect: fetch.preconnect },
      ),
    })
    yield* Effect.promise(async () => {
      await expect(api.location.get({ location: { directory: invalid } })).rejects.toMatchObject({
        _tag: "InvalidRequestError",
        kind: "Query",
        field: "location[directory]",
      })
    })
  }),
)

import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import fs from "node:fs/promises"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Effect, Layer, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { ServerFetch } from "../src/fetch"

it.live(
  "serves lazy review bases, committed diffs, and unavailable-base errors",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-vcs-endpoint-")))
      yield* Effect.promise(async () => {
        await $`git init -b main`.cwd(tmp.path).quiet()
        await $`git config commit.gpgsign false`.cwd(tmp.path).quiet()
        await $`git config user.email test@opencode.test`.cwd(tmp.path).quiet()
        await $`git config user.name Test`.cwd(tmp.path).quiet()
        await Bun.write(path.join(tmp.path, "file.txt"), "base\n")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit -m initial`.cwd(tmp.path).quiet()
        await $`git checkout -b feature main`.cwd(tmp.path).quiet()
        await Bun.write(path.join(tmp.path, "file.txt"), "committed\n")
        await $`git commit -am feature`.cwd(tmp.path).quiet()
        await Bun.write(path.join(tmp.path, "file.txt"), "dirty\n")
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const url = new URL("/api/vcs/base", server.base)
      url.searchParams.set("location[directory]", tmp.path)
      const base = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, { headers: server.headers })
          const body: unknown = await response.json()
          if (!isRecord(body) || !isRecord(body.data)) throw new Error("VCS provider not ready")
          return body
        },
        catch: (cause) => cause,
      }).pipe(Effect.retry(Schedule.spaced("10 millis")), Effect.timeout("2 seconds"))
      expect(base).toMatchObject({
        data: { name: "main", ref: "refs/heads/main", source: "reflog" },
      })
      yield* Effect.promise(() => $`git branch -m ambiguous`.cwd(tmp.path).quiet())
      const ambiguous = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(ambiguous.status).toBe(503)
      expect(yield* Effect.promise(() => ambiguous.json())).toMatchObject({
        _tag: "ServiceUnavailableError",
        message: "Choose a review base",
      })
      url.pathname = "/api/vcs/diff"
      url.searchParams.set("mode", "committed")
      url.searchParams.set("base", "refs/heads/main")
      const diff = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(diff.status).toBe(200)
      expect(yield* Effect.promise(() => diff.json())).toMatchObject({
        data: [{ file: "file.txt", patch: expect.stringContaining("-base\n+committed"), additions: 1, deletions: 1 }],
      })
      url.searchParams.set("base", "missing")
      const unavailable = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(unavailable.status).toBe(503)
      expect(yield* Effect.promise(() => unavailable.json())).toMatchObject({
        _tag: "ServiceUnavailableError",
        service: "vcs",
      })
      yield* Effect.promise(() => $`git branch -D main`.cwd(tmp.path).quiet())
      url.searchParams.delete("base")
      url.searchParams.set("mode", "branch")
      const noBase = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(noBase.status).toBe(503)
      expect(yield* Effect.promise(() => noBase.json())).toMatchObject({
        _tag: "ServiceUnavailableError",
        service: "vcs",
        message: "No review base available",
      })
    }),
  20_000,
)

it.live(
  "serves the commit graph with pagination, null capability, and failure errors",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-vcs-graph-")))
      yield* Effect.promise(async () => {
        await $`git init -b main`.cwd(tmp.path).quiet()
        await $`git config commit.gpgsign false`.cwd(tmp.path).quiet()
        await $`git config user.email test@opencode.test`.cwd(tmp.path).quiet()
        await $`git config user.name Test`.cwd(tmp.path).quiet()
        await Bun.write(path.join(tmp.path, "file.txt"), "base\n")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit -m initial`.cwd(tmp.path).quiet()
        await Bun.write(path.join(tmp.path, "file.txt"), "next\n")
        await $`git commit -am second`.cwd(tmp.path).quiet()
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const graphUrl = () => {
        const url = new URL("/api/vcs/graph", server.base)
        url.searchParams.set("location[directory]", tmp.path)
        return url
      }
      const page = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(graphUrl(), { headers: server.headers })
          const body: unknown = await response.json()
          if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.commits)) {
            throw new Error("VCS graph provider not ready")
          }
          return body
        },
        catch: (cause) => cause,
      }).pipe(Effect.retry(Schedule.spaced("10 millis")), Effect.timeout("2 seconds"))
      expect(page).toMatchObject({
        data: {
          hasMore: false,
          commits: [
            {
              subject: "second",
              refs: [
                { name: "HEAD", kind: "head" },
                { name: "main", kind: "branch" },
              ],
            },
            { subject: "initial", refs: [] },
          ],
        },
      })
      const limited = graphUrl()
      limited.searchParams.set("limit", "1")
      const first = yield* Effect.promise(() => fetch(limited, { headers: server.headers }))
      expect(yield* Effect.promise(() => first.json())).toMatchObject({
        data: { hasMore: true, commits: [{ subject: "second" }] },
      })
      const skipped = graphUrl()
      skipped.searchParams.set("skip", "1")
      const tail = yield* Effect.promise(() => fetch(skipped, { headers: server.headers }))
      expect(yield* Effect.promise(() => tail.json())).toMatchObject({
        data: { hasMore: false, commits: [{ subject: "initial" }] },
      })
      const oversized = graphUrl()
      oversized.searchParams.set("limit", "5000")
      const clamped = yield* Effect.promise(() => fetch(oversized, { headers: server.headers }))
      expect(clamped.status).toBe(200)
      const invalid = graphUrl()
      invalid.searchParams.set("limit", "0")
      const rejected = yield* Effect.promise(() => fetch(invalid, { headers: server.headers }))
      expect(rejected.status).toBe(400)
      const plain = path.join(tmp.path, "not-a-repo")
      yield* Effect.promise(() => fs.mkdir(plain))
      yield* Effect.promise(() => Bun.write(path.join(plain, "keep"), ""))
      const unsupported = new URL("/api/vcs/graph", server.base)
      unsupported.searchParams.set("location[directory]", plain)
      const none = yield* Effect.promise(() => fetch(unsupported, { headers: server.headers }))
      expect(none.status).toBe(200)
      expect(yield* Effect.promise(() => none.json())).toMatchObject({ data: null })
    }),
  20_000,
)

it.live("maps a failing graph provider to HTTP 503 instead of an empty page", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-vcs-graph-failure-")))
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        config: { directory: tmp.path },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [
          SdkPlugins.node.replace(
            Layer.succeed(
              SdkPlugins.Service,
              SdkPlugins.Service.of({
                register: () => Effect.void,
                all: () => [
                  {
                    id: "failing-vcs-graph",
                    revision: "test",
                    effect: (ctx) =>
                      ctx.vcs
                        .transform((editor) => {
                          editor.add({
                            id: "failing",
                            name: "Failing VCS",
                            info: () => Effect.succeed({ branch: {} }),
                            branches: () => Effect.succeed([]),
                            status: () => Effect.succeed([]),
                            diff: () => Effect.succeed([]),
                            graph: () => Effect.fail(new Error("provider failure")),
                          })
                          editor.default.set("failing")
                        })
                        .pipe(Effect.asVoid),
                  },
                ],
              }),
            ),
          ),
        ],
      },
    )
    const url = new URL("http://opencode.local/api/vcs/graph")
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => handler(new Request(url))).pipe(
      Effect.filterOrFail((response) => response.status === 503),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("2 seconds"),
    )
    expect(response.status).toBe(503)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "ServiceUnavailableError",
      service: "vcs",
      message: "VCS provider could not produce a commit graph",
    })
  }),
)

it.live("maps a failing base provider to HTTP 503 instead of null metadata", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-vcs-failure-")))
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        config: { directory: tmp.path },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [
          SdkPlugins.node.replace(
            Layer.succeed(
              SdkPlugins.Service,
              SdkPlugins.Service.of({
                register: () => Effect.void,
                all: () => [
                  {
                    id: "failing-vcs",
                    revision: "test",
                    effect: (ctx) =>
                      ctx.vcs
                        .transform((editor) => {
                          editor.add({
                            id: "failing",
                            name: "Failing VCS",
                            info: () => Effect.succeed({ branch: {} }),
                            branches: () => Effect.succeed([]),
                            status: () => Effect.succeed([]),
                            diff: () => Effect.succeed([]),
                            base: () => Effect.fail(new Error("provider failure")),
                          })
                          editor.default.set("failing")
                        })
                        .pipe(Effect.asVoid),
                  },
                ],
              }),
            ),
          ),
        ],
      },
    )
    const url = new URL("http://opencode.local/api/vcs/base")
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => handler(new Request(url))).pipe(
      Effect.filterOrFail((response) => response.status === 503),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("2 seconds"),
    )
    expect(response.status).toBe(503)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "ServiceUnavailableError",
      service: "vcs",
      message: "VCS provider could not resolve a review base",
    })
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

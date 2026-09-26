import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Effect, Layer, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { ServerFetch } from "../src/fetch"

it.live(
  "initializes Git in a markerless project and refreshes its location",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-vcs-init-")))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, "hello.txt"), "hello\n"))
      const server = yield* startServer(path.join(tmp.path, "config"))
      const url = new URL("/api/vcs/init", server.base)
      url.searchParams.set("location[directory]", tmp.path)
      const before = yield* Effect.promise(() =>
        fetch(new URL(`/api/location${url.search}`, server.base), { headers: server.headers }),
      )
      expect(before.status).toBe(200)
      const original = yield* Effect.promise(() => before.json())
      const initialized = yield* Effect.promise(() => fetch(url, { method: "POST", headers: server.headers }))
      expect(initialized.status).toBe(204)
      expect(yield* Effect.promise(() => $`git -C ${tmp.path} rev-parse --is-inside-work-tree`.text())).toBe("true\n")
      url.pathname = "/api/location"
      const location = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(location.status).toBe(200)
      const refreshed = yield* Effect.promise(() => location.json())
      expect(refreshed).toMatchObject({ project: { directory: tmp.path } })
      expect(refreshed.project.id).not.toBe(original.project.id)
      const projects = yield* Effect.promise(() =>
        fetch(new URL("/api/project", server.base), { headers: server.headers }),
      )
      expect(yield* Effect.promise(() => projects.json())).toContainEqual(
        expect.objectContaining({ id: refreshed.project.id, vcs: "git" }),
      )
      url.pathname = "/api/vcs"
      const vcs = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, { headers: server.headers })
          const body: unknown = await response.json()
          if (!isRecord(body) || !isRecord(body.data) || body.data.provider !== "git")
            throw new Error("Git provider not ready")
          return body
        },
        catch: (cause) => cause,
      }).pipe(Effect.retry(Schedule.spaced("10 millis")), Effect.timeout("2 seconds"))
      expect(vcs).toMatchObject({ data: { provider: "git" } })
      url.pathname = "/api/vcs/diff"
      url.searchParams.set("mode", "working")
      const diff = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(diff.status).toBe(200)
      expect(yield* Effect.promise(() => diff.json())).toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ file: "hello.txt" })]),
      })
      url.searchParams.delete("mode")
      url.pathname = "/api/vcs/init"
      const repeated = yield* Effect.promise(() => fetch(url, { method: "POST", headers: server.headers }))
      expect(repeated.status).toBe(409)
    }),
  15_000,
)

it.live(
  "does not create a project directory while initializing Git",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-vcs-missing-")))
      const server = yield* startServer(path.join(tmp.path, "config"))
      const directory = path.join(tmp.path, "absent")
      const url = new URL("/api/vcs/init", server.base)
      url.searchParams.set("location[directory]", directory)
      const response = yield* Effect.promise(() => fetch(url, { method: "POST", headers: server.headers }))
      expect(response.status).not.toBe(204)
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, ".git", "HEAD")).exists())).toBe(false)
    }),
  15_000,
)

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

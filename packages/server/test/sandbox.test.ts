import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Cause, Effect, Exit } from "effect"
import { Global } from "@opencode/util/global"
import { MacSandbox } from "@opencode/core/sandbox/macos"
import { Sandbox } from "@opencode/core/sandbox"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const kernel = probe?.exitCode === 0 ? it.live : it.live.skip
const macos = process.platform === "darwin" ? it.live : it.live.skip
const authorization = `Basic ${btoa("opencode:secret")}`

const fixture = Effect.fnUntraced(function* (sandbox: Sandbox.Options = {}) {
  const tmp = yield* tmpdirScoped("opencode-sandbox-server-")
  const directory = path.join(tmp.path, "project")
  yield* Effect.promise(() => fs.mkdir(directory))
  const handler = yield* ServerFetch.make(
    {
      sandbox,
      password: "secret",
      database: { path: ":memory:" },
      config: { project: false, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    },
    {
      overrides: [
        Global.node.replace(
          Global.layerWith({
            home: tmp.path,
            config: path.join(tmp.path, "config"),
            data: path.join(tmp.path, "data"),
            state: path.join(tmp.path, "state"),
            tmp: path.join(tmp.path, "tmp"),
            cache: path.join(tmp.path, "cache"),
          }),
        ),
      ],
    },
  )
  return {
    directory,
    handler,
    request: (headers = { authorization }) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/experimental/sandbox/status?location[directory]=${encodeURIComponent(directory)}`, {
            headers,
          }),
        ),
      ),
  }
})

it.live("sandbox status is authenticated and reports the server's disabled policy", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    expect((yield* f.request({ authorization: "" })).status).toBe(401)
    const result = yield* f.request()
    expect(result.status).toBe(200)
    expect(yield* Effect.promise(() => result.json())).toMatchObject({
      active: false,
      reads: "unrestricted",
      escalation: "disabled",
      writableRoots: [],
    })
  }),
)

it.live(
  "sandbox approvals require compatible presentation, remain per request, and allow unacknowledged rejection",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const request = (route: string, method: string, body?: unknown) =>
        Effect.promise(async () => {
          const response = await f.handler(
            new Request(`http://opencode.local${route}`, {
              method,
              headers: { authorization, "content-type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
            }),
          )
          return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
        })
      const session = yield* request("/api/session", "POST", {
        location: { directory: f.directory },
        permissions: [{ action: "sandbox.*", resource: "*", effect: "ask" }],
      })
      expect(session.status).toBe(200)
      const sessionID = session.body.data.id
      for (const action of ["sandbox.exec", "sandbox.workspace"]) {
        const first = yield* request(`/api/session/${sessionID}/permission`, "POST", { action, resources: ["one"] })
        const second = yield* request(`/api/session/${sessionID}/permission`, "POST", { action, resources: ["two"] })
        expect(first.body.data.effect).toBe("ask")
        const route = `/api/session/${sessionID}/permission/${first.body.data.id}/reply`
        expect((yield* request(route, "POST", { decision: "once" })).status).toBe(409)
        expect((yield* request(route, "POST", { decision: "always", experimental: { acknowledgeSandbox: true } })).status).toBe(409)
        // A generic/API-created request has no execution-leaf prefix, even if the client claims session scope.
        expect(
          (yield* request(route, "POST", { decision: "always", experimental: { acknowledgeSandbox: true, saveSandboxPrefix: true } }))
            .status,
        ).toBe(409)
        expect((yield* request(route, "POST", { decision: "once", experimental: { acknowledgeSandbox: true } })).status).toBe(204)
        const pending = yield* request(`/api/session/${sessionID}/permission`, "GET")
        expect(pending.body.data.map((item: { id: string }) => item.id)).toEqual([second.body.data.id])
        expect(
          (yield* request(`/api/session/${sessionID}/permission/${second.body.data.id}/reply`, "POST", {
            decision: "reject",
          })).status,
        ).toBe(204)
        expect((yield* request(route, "POST", { decision: "once", experimental: { acknowledgeSandbox: true } })).status).toBe(404)
      }
    }),
)

kernel("embedded routes report checked strict and broad policies with canonical writable roots", () =>
  Effect.gen(function* () {
    for (const fullDiskRead of [false, true]) {
      const f = yield* fixture({ enabled: true, fullDiskRead, approval: "never" })
      const result = yield* f.request()
      expect(result.status).toBe(200)
      const status = yield* Effect.promise(() => result.json())
      expect(status).toMatchObject({
        active: true,
        reads: fullDiskRead ? "broad" : "restricted",
        escalation: "never",
      })
      expect(status.writableRoots).toContain(yield* Effect.promise(() => fs.realpath(f.directory)))
    }
  }),
)

macos("invalid roots prevent embedded server startup before any ready response", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(fixture({ enabled: true, readableRoots: ["relative-root"] }))
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Invalid sandbox roots")
  }),
)

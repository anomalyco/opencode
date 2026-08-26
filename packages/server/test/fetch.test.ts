import { expect } from "bun:test"
import { createServer, type Server } from "node:http"
import { makeMemoryDriver } from "@opencode-ai/core/environment/index"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  fs: { filewatcher: false },
} as const

type Handler = (request: Request) => Promise<Response>

function occupy(server: Server, port: number) {
  return Effect.callback<void, Error>((resume) => {
    server.once("error", (error) => resume(Effect.fail(error)))
    server.listen(port, "localhost", () => resume(Effect.void))
  })
}

const ready = (handler: Handler) =>
  Effect.promise(() => handler(new Request("http://opencode.local/api/model/default")))

const connectOpenAI = (handler: Handler) =>
  Effect.promise(() =>
    handler(
      new Request("http://opencode.local/api/integration/openai/connect/oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ methodID: "chatgpt-browser" }),
      }),
    ),
  )

const workspaceDriver = WorkspaceDriver.make({
  create: ({ workspaceID }) => Effect.succeed({ binding: { workspaceID } }),
  connect: () => Effect.succeed(makeMemoryDriver()),
  suspendForIdle: () => Effect.void,
  destroy: () => Effect.void,
})

it.live("serves the HttpApi and enforces Basic auth like the Node server", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({ ...options, password: "secret" })

    const denied = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(denied.status).toBe(401)

    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/health", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (typeof body !== "object" || body === null) throw new Error("Expected a health response object")
    expect((body as Record<string, unknown>)["healthy"]).toBe(true)
  }).pipe(Effect.scoped),
)

it.live("activates credentials through the HttpApi", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const response = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/credential/cred_missing/activate", { method: "POST" })),
    )
    expect(response.status).toBe(204)
  }).pipe(Effect.scoped),
)

it.live("serves unauthenticated and answers CORS preflight when no password is configured", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)

    const response = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(response.status).toBe(200)

    const preflight = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/health", {
          method: "OPTIONS",
          headers: {
            origin: "http://localhost:3000",
            "access-control-request-method": "GET",
          },
        }),
      ),
    )
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  }).pipe(Effect.scoped),
)

it.live("serves plugin update operations through the HttpApi", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const check = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/plugin/update")))
    expect(check.status).toBe(200)
    expect(yield* Effect.promise(() => check.json())).toMatchObject({ data: expect.any(Array) })

    const update = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/plugin/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "missing-plugin" }),
        }),
      ),
    )
    expect(update.status).toBe(200)
    expect(yield* Effect.promise(() => update.json())).toMatchObject({
      data: { name: "missing-plugin", status: "failed", error: "Plugin not found" },
    })

    const updateAll = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/plugin/update-all", { method: "POST" })),
    )
    expect(updateAll.status).toBe(200)
    expect(yield* Effect.promise(() => updateAll.json())).toMatchObject({ data: expect.any(Array) })
  }).pipe(Effect.scoped),
)

it.live("cancels a stale OpenAI OAuth callback server before falling back", () =>
  Effect.gen(function* () {
    const requests: string[] = []
    const blocker = createServer((request, response) => {
      requests.push(request.url ?? "")
      response.end("cancelled", () => blocker.close())
    })
    yield* occupy(blocker, 1455)
    yield* Effect.addFinalizer(() => Effect.sync(() => blocker.close()))
    const handler = yield* ServerFetch.make(options)
    yield* ready(handler)
    const response = yield* connectOpenAI(handler)

    expect(response.status).toBe(200)
    expect(requests).toContain("/cancel")
    const body = (yield* Effect.promise(() => response.json())) as { data: { url: string } }
    expect(new URL(body.data.url).searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback")
  }).pipe(Effect.scoped),
)

it.live("falls back to port 1457 when OpenAI OAuth port 1455 remains busy", () =>
  Effect.gen(function* () {
    const requests: string[] = []
    const blocker = createServer((request, response) => {
      requests.push(request.url ?? "")
      response.end("still running")
    })
    yield* occupy(blocker, 1455)
    yield* Effect.addFinalizer(() => Effect.sync(() => blocker.close()))
    const handler = yield* ServerFetch.make(options)
    yield* ready(handler)
    const response = yield* connectOpenAI(handler)

    expect(response.status).toBe(200)
    expect(requests).toContain("/cancel")
    const body = (yield* Effect.promise(() => response.json())) as { data: { url: string } }
    expect(new URL(body.data.url).searchParams.get("redirect_uri")).toBe("http://localhost:1457/auth/callback")
  }).pipe(Effect.scoped),
)

it.live("explains how to recover when both OpenAI OAuth callback ports are busy", () =>
  Effect.gen(function* () {
    const preferred = createServer((_request, response) => response.end("still running"))
    const fallback = createServer()
    yield* occupy(preferred, 1455)
    yield* occupy(fallback, 1457)
    yield* Effect.addFinalizer(() => Effect.sync(() => preferred.close()))
    yield* Effect.addFinalizer(() => Effect.sync(() => fallback.close()))
    const handler = yield* ServerFetch.make(options)
    yield* ready(handler)
    const response = yield* connectOpenAI(handler)

    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.json())).toEqual({
      _tag: "InvalidRequestError",
      message:
        "OpenAI browser login needs local port 1455 or 1457, but both are already in use. Stop the processes using those ports or choose ChatGPT Pro/Plus (headless), then try again.",
      kind: "integration_authorization",
    })
  }).pipe(Effect.scoped),
)

it.live("treats destroying a missing workspace as success", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/workspace/${Workspace.ID.create()}`, {
          method: "DELETE",
        }),
      ),
    )

    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toEqual({ destroyed: false })
  }).pipe(Effect.scoped),
)

it.live("creates idempotent caller-identified workspaces through the HttpApi", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options, {
      overrides: [
        [WorkspaceDriver.node, WorkspaceDriver.registryNode({ fake: workspaceDriver, other: workspaceDriver })],
      ],
    })
    const id = Workspace.ID.create()
    const create = (body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request("http://opencode.local/api/workspace", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )

    const supplied = yield* create({ id, provider: "fake" })
    expect(supplied.status).toBe(200)
    expect(yield* Effect.promise(() => supplied.json())).toEqual({ data: id })

    const repeated = yield* create({ id, provider: "fake" })
    expect(repeated.status).toBe(200)
    expect(yield* Effect.promise(() => repeated.json())).toEqual({ data: id })

    const conflict = yield* create({ id, provider: "other" })
    expect(conflict.status).toBe(409)
    expect(yield* Effect.promise(() => conflict.json())).toMatchObject({
      _tag: "ConflictError",
      resource: id,
    })

    expect((yield* create({ id: "invalid", provider: "fake" })).status).toBe(400)

    const minted = yield* create({ provider: "fake" })
    expect(minted.status).toBe(200)
    expect(yield* Effect.promise(() => minted.json())).toMatchObject({ data: expect.stringMatching(/^wrk_/) })
  }).pipe(Effect.scoped),
)

it.live("serves the session view operation and missing-session error", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ).then((response) => response.json()),
    )
    if (typeof created !== "object" || created === null || !("data" in created))
      return yield* Effect.die(new Error("Expected a session response"))
    const data = created.data
    if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string")
      return yield* Effect.die(new Error("Expected a session ID"))

    const viewed = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${data.id}/view`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idle: 0 }),
        }),
      ),
    )
    expect(viewed.status).toBe(204)

    const invalid = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session/${data.id}/view`, { method: "POST" })),
    )
    expect(invalid.status).toBe(400)

    const missing = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session/ses_missing_view/view", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idle: 0 }),
        }),
      ),
    )
    expect(missing.status).toBe(404)
  }).pipe(Effect.scoped),
)

// Pins the eager-boot guarantee: the application layer is built before the handler returns, so
// an aborted first request cannot interrupt layer construction and wedge every later request
// (the Effect-TS/effect#6319 failure class that lazy first-request builds are prone to).
it.live("stays serviceable when the first request aborts", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)

    const aborted = yield* Effect.promise(() => {
      const controller = new AbortController()
      const first = handler(new Request("http://opencode.local/api/health", { signal: controller.signal }))
      controller.abort()
      return first.then(
        () => "resolved" as const,
        () => "rejected" as const,
      )
    })
    expect(["resolved", "rejected"]).toContain(aborted)

    const second = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(second.status).toBe(200)
  }).pipe(Effect.scoped),
)

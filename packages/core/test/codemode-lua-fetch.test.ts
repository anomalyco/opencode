import { expect } from "bun:test"
import { CodeMode } from "@opencode/codemode"
import { CodeModeExecution } from "@opencode/core/codemode/execution"
import { CodeModeFetch } from "@opencode/core/codemode/fetch"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Effect, Fiber, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity } from "./lib/tool"

const fetch = CodeModeFetch.luaExtension.globals.fetch
const it = testEffect(
  Layer.merge(
    Layer.succeed(CodeModeExecution.Service, {
      ...toolIdentity,
      id: Tool.CallID.make("call_fetch"),
      sessionID: Session.ID.make("ses_fetch"),
      progress: () => Effect.void,
    }),
    permissionLayer({ assert: () => Effect.void, assertNotDenied: () => Effect.void }),
  ),
)

const serve = (handle: (req: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle })),
    (server) => Effect.promise(() => server.stop(true)),
  )

it.live("returns only JSON data and follows a checked redirect", () =>
  Effect.gen(function* () {
    const seen: string[] = []
    const server = yield* serve(async (req) => {
      if (new URL(req.url).pathname === "/start")
        return new Response("unused", { status: 307, headers: { location: "/end" } })
      return new Response(`${req.method} ${req.headers.get("x-test")} ${await req.text()}`, {
        status: 409,
        statusText: "Conflict",
        headers: { "x-result": "done" },
      })
    })
    const url = server.url.origin
    const result = yield* fetch(`${url}/not-used/../start`, {
      method: "POST",
      body: "café",
      headers: { "x-test": "yes" },
    }).pipe(
      Effect.provide(
        permissionLayer({
          assert: (input) =>
            Effect.sync(() => {
              seen.push(`${input.action} ${input.resources[0]}`)
            }),
          assertNotDenied: (input) =>
            Effect.sync(() => {
              seen.push(`redirect ${input.resources[0]}`)
            }),
        }),
      ),
    )
    expect(seen).toEqual([`webfetch ${url}/start`, `redirect ${url}/end`])
    expect(result).toEqual({
      status: 409,
      statusText: "Conflict",
      ok: false,
      redirected: true,
      url: `${url}/end`,
      headers: expect.objectContaining({ "x-result": "done" }),
      body: "POST yes café",
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  }),
)

it.effect("rejects unsupported arguments before checking permission or opening a connection", () =>
  Effect.gen(function* () {
    const url = "http://127.0.0.1/"
    for (const args of [
      [],
      [3],
      ["file:///etc/passwd"],
      ["data:text/plain,wrong"],
      ["http://user:pass@localhost/"],
      [url, {}, 42],
      [url, null],
      [url, []],
      [url, { method: 1 }],
      [url, { body: {} }],
      [url, { headers: { bad: 3 } }],
      ...["auth", "proxy", "tls", "unix", "signal", "redirect"].map((key) => [url, { [key]: "bad" }]),
    ]) {
      yield* Effect.flip(fetch(...args))
    }
  }).pipe(Effect.provide(permissionLayer())),
)

it.live("never requests a denied redirect target and closes its streaming predecessor", () =>
  Effect.gen(function* () {
    const closed = Promise.withResolvers<void>()
    const hits: string[] = []
    const server = yield* serve((req) => {
      hits.push(new URL(req.url).pathname)
      req.signal.addEventListener("abort", () => closed.resolve())
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
          },
        }),
        {
          status: 302,
          headers: { location: "/denied" },
        },
      )
    })
    const error = yield* fetch(server.url.href).pipe(
      Effect.flip,
      Effect.provide(
        permissionLayer({
          assert: () => Effect.void,
          assertNotDenied: (input) =>
            Effect.fail(
              new Permission.BlockedError({ permission: input.action, resources: input.resources, rules: [] }),
            ),
        }),
      ),
    )
    expect(String(error)).toContain("Permission denied: webfetch")
    expect(hits).toEqual(["/"])
    yield* Effect.promise(() => closed.promise)
  }),
)

it.live("the legacy JavaScript extension still returns callable response and header methods", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ answer: 42 }, { headers: { "x-test": "legacy" } }))
    const result = yield* CodeMode.execute({
      extensions: [CodeModeFetch.extension],
      bindings: { url: server.url.href },
      code: `const r = await fetch(url); return [r.headers.get("X-Test"), (await r.json()).answer]`,
    })
    expect(result).toMatchObject({ ok: true, value: ["legacy", 42] })
  }),
)

it.live("rejects a chunked body over 1 MiB without waiting for EOF", () =>
  Effect.gen(function* () {
    const closed = Promise.withResolvers<void>()
    const server = yield* serve((req) => {
      req.signal.addEventListener("abort", () => closed.resolve())
      return new Response(
        new ReadableStream({
          start(controller) {
            // No Content-Length or EOF, and fewer than 1 MiB of decoded characters.
            controller.enqueue(new TextEncoder().encode("é".repeat(512 * 1024 + 1)))
          },
        }),
      )
    })
    expect(String(yield* Effect.flip(fetch(server.url.href)))).toContain("exceeds 1 MiB")
    yield* Effect.promise(() => closed.promise)
  }),
)

for (const phase of ["headers", "body"]) {
  it.live(`interrupting fetch aborts a request stalled at ${phase}`, () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const closed = Promise.withResolvers<void>()
      const server = yield* serve((req) => {
        req.signal.addEventListener("abort", () => closed.resolve())
        if (phase === "headers") {
          started.resolve()
          return closed.promise.then(() => new Response())
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]))
              started.resolve()
            },
          }),
        )
      })
      const fiber = yield* fetch(server.url.href).pipe(Effect.forkChild)
      yield* Effect.promise(() => started.promise)
      yield* Fiber.interrupt(fiber)
      yield* Effect.promise(() => closed.promise)
    }),
  )
}

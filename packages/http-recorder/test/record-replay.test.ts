import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Layer, Scope, Stream } from "effect"
import { Headers, HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { HttpRecorder } from "../src"
import { HttpRecorderInternal } from "../src/internal"
import { redactedErrorRequest } from "../src/internal-effect"
import type { Interaction } from "../src/schema"

const seedCassetteDirectory = (directory: string, name: string, interactions: ReadonlyArray<Interaction>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cassette = yield* HttpRecorderInternal.Cassette.Service
      yield* Effect.forEach(interactions, (interaction) => cassette.append(name, interaction))
    }).pipe(
      Effect.provide(HttpRecorderInternal.Cassette.fileSystem({ directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )

const post = (url: string, body: object) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const request = HttpClientRequest.post(url, {
      headers: { "content-type": "application/json" },
      body: HttpBody.text(JSON.stringify(body), "application/json"),
    })
    const response = yield* http.execute(request)
    return yield* response.text
  })

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.http("record-replay/multi-step"))))

const runWith = <A, E>(
  name: string,
  options: HttpRecorder.RecorderOptions,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.http(name, options))))

const runRecorder = <A, E>(effect: Effect.Effect<A, E, HttpRecorderInternal.Cassette.Service | Scope.Scope>) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(
        Effect.provide(
          HttpRecorderInternal.Cassette.fileSystem({
            directory: fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-")),
          }),
        ),
        Effect.provide(NodeFileSystem.layer),
      ),
    ),
  )

const failureText = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return ""
  return Cause.prettyErrors(exit.cause).join("\n")
}

describe("http-recorder", () => {
  test("redacts sensitive URL query parameters", () => {
    expect(
      HttpRecorderInternal.redactUrl(
        "https://example.test/path?key=secret-google-key&api_key=secret-openai-key&safe=value&X-Amz-Signature=secret-signature",
      ),
    ).toBe(
      "https://example.test/path?key=%5BREDACTED%5D&api_key=%5BREDACTED%5D&safe=value&X-Amz-Signature=%5BREDACTED%5D",
    )
  })

  test("redacts URL credentials", () => {
    expect(HttpRecorderInternal.redactUrl("https://user:password@example.test/path?safe=value")).toBe(
      "https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/path?safe=value",
    )
  })

  test("applies custom URL redaction after built-in redaction", () => {
    expect(
      HttpRecorderInternal.redactUrl(
        "https://example.test/accounts/real-account/path?key=secret-key",
        undefined,
        (url) => url.replace("/accounts/real-account/", "/accounts/{account}/"),
      ),
    ).toBe("https://example.test/accounts/{account}/path?key=%5BREDACTED%5D")
  })

  test("redacts sensitive headers when allow-listed", () => {
    expect(
      HttpRecorderInternal.redactHeaders(
        {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          "x-custom-token": "custom-secret",
          "x-api-key": "secret-key",
          "x-goog-api-key": "secret-google-key",
        },
        ["authorization", "content-type", "x-api-key", "x-goog-api-key", "x-custom-token"],
        ["x-custom-token"],
      ),
    ).toEqual({
      authorization: "[REDACTED]",
      "content-type": "application/json",
      "x-api-key": "[REDACTED]",
      "x-custom-token": "[REDACTED]",
      "x-goog-api-key": "[REDACTED]",
    })
  })

  test("redacts error requests without retaining headers, params, or body", () => {
    const request = HttpClientRequest.post("https://example.test/path", {
      headers: { authorization: "Bearer super-secret" },
      body: HttpBody.text("super-secret-body", "text/plain"),
    }).pipe(HttpClientRequest.setUrlParam("api_key", "super-secret-key"))

    expect(redactedErrorRequest(request).toJSON()).toMatchObject({
      url: "https://example.test/path",
      urlParams: { params: [] },
      headers: {},
      body: { _tag: "Empty" },
    })
  })

  test("detects secret-looking values without returning the secret", () => {
    expect(
      HttpRecorderInternal.secretFindings({
        version: 1,
        interactions: [
          {
            transport: "http",
            request: {
              method: "POST",
              url: "https://example.test/path?key=sk-123456789012345678901234",
              headers: {},
              body: JSON.stringify({ nested: "AIzaSyDHibiBRvJZLsFnPYPoiTwxY4ztQ55yqCE" }),
            },
            response: {
              status: 200,
              headers: {},
              body: "Bearer abcdefghijklmnopqrstuvwxyz",
            },
          },
        ],
      }),
    ).toEqual([
      { path: "interactions[0].request.url", reason: "API key" },
      { path: "interactions[0].request.body", reason: "Google API key" },
      { path: "interactions[0].response.body", reason: "bearer token" },
    ])
  })

  test("detects secret-looking values inside metadata", () => {
    expect(
      HttpRecorderInternal.secretFindings({
        version: 1,
        metadata: { token: "sk-123456789012345678901234" },
        interactions: [],
      }),
    ).toEqual([{ path: "metadata.token", reason: "API key" }])
  })

  test("redacts configured and common sensitive JSON fields", () => {
    const redactor = HttpRecorderInternal.Redactor.make({ jsonFields: ["account_id"] })
    const request = redactor.request({
      method: "POST",
      url: "https://example.test/path",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "secret-password",
        accessToken: "access-token",
        nested: { account_id: "account-123", safe: "visible" },
      }),
    })

    expect(JSON.parse(request.body)).toEqual({
      password: "[REDACTED]",
      accessToken: "[REDACTED]",
      nested: { account_id: "[REDACTED]", safe: "visible" },
    })
  })

  test("extends default header redaction and allow lists", () => {
    const redactor = HttpRecorderInternal.Redactor.make({
      headers: ["x-custom-token"],
      allowRequestHeaders: ["anthropic-version", "x-custom-token"],
    })

    expect(
      redactor.request({
        method: "GET",
        url: "https://example.test/path",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-custom-token": "secret",
        },
        body: "",
      }).headers,
    ).toEqual({
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-custom-token": "[REDACTED]",
    })
  })

  test("records WebSocket frames in observed client/server order", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    const response = JSON.stringify({ type: "response.completed", token: "server-secret" })
    let receive: ((message: string | Uint8Array) => Effect.Effect<unknown, unknown, unknown> | void) | undefined
    const upstream = Socket.make({
      runRaw: (handler, options) =>
        Effect.gen(function* () {
          receive = handler
          if (options?.onOpen) yield* options.onOpen
          receive = undefined
        }),
      writer: Effect.succeed(() =>
        Effect.suspend(() => {
          const result = receive?.(response)
          return Effect.isEffect(result) ? Effect.asVoid(result) : Effect.void
        }),
      ),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runRaw(() => {}, {
          onOpen: write(JSON.stringify({ type: "response.create", token: "client-secret" })),
        })
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorderInternal.socketLayer(
            "websocket/record",
            { url: "wss://example.test/realtime", headers: { "content-type": "application/json" } },
            { directory, metadata: { provider: "test" }, mode: "record" },
          ).pipe(Layer.provide(Layer.succeed(Socket.Socket, upstream))),
        ),
      ),
    )

    expect(JSON.parse(fs.readFileSync(path.join(directory, "websocket/record.json"), "utf8"))).toMatchObject({
      interactions: [
        {
          transport: "websocket",
          open: { url: "wss://example.test/realtime", headers: { "content-type": "application/json" } },
          events: [
            { direction: "client", kind: "text", body: '{"type":"response.create","token":"[REDACTED]"}' },
            { direction: "server", kind: "text", body: '{"type":"response.completed","token":"[REDACTED]"}' },
          ],
        },
      ],
    })
  })

  test("WebSocket replay preserves causal frame ordering", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    await seedCassetteDirectory(directory, "websocket/replay", [
      {
        transport: "websocket",
        open: { url: "wss://example.test/realtime", headers: {} },
        events: [
          { direction: "server", kind: "text", body: '{"type":"session.created"}' },
          { direction: "client", kind: "text", body: '{"type":"response.create","prompt":"hello"}' },
          { direction: "server", kind: "text", body: '{"type":"response.completed"}' },
        ],
      },
    ])

    const received: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runRaw((message) => {
          if (typeof message !== "string") return
          received.push(message)
          if (JSON.parse(message).type === "session.created")
            return write('{"prompt":"hello","type":"response.create"}')
        })
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorderInternal.socketLayer(
            "websocket/replay",
            { url: "wss://example.test/realtime" },
            { directory, compareClientMessagesAsJson: true, mode: "replay" },
          ).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
                  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
                }),
              ),
            ),
          ),
        ),
      ),
    )

    expect(received).toEqual(['{"type":"session.created"}', '{"type":"response.completed"}'])
  })

  test("the public socket decorator replays a provided Effect socket", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    await seedCassetteDirectory(directory, "websocket/public-layer", [
      {
        transport: "websocket",
        open: { url: "", headers: {} },
        events: [
          { direction: "client", kind: "text", body: "hello" },
          { direction: "server", kind: "text", body: "hello" },
        ],
      },
    ])

    const received: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runString(
          (message) =>
            Effect.gen(function* () {
              received.push(message)
              yield* write(new Socket.CloseEvent(1000))
            }),
          { onOpen: write("hello") },
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorder.socket("websocket/public-layer", { directory }).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
                  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
                }),
              ),
            ),
          ),
        ),
      ),
    )

    expect(received).toEqual(["hello"])
  })

  test("WebSocket replay runs message handlers concurrently", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    await seedCassetteDirectory(directory, "websocket/concurrent-handlers", [
      {
        transport: "websocket",
        open: { url: "wss://example.test/realtime", headers: {} },
        events: [
          { direction: "server", kind: "text", body: "first" },
          { direction: "server", kind: "text", body: "second" },
        ],
      },
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const second = yield* Deferred.make<void>()
        yield* socket.runString((message) =>
          message === "first" ? Deferred.await(second) : Deferred.succeed(second, undefined),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorderInternal.socketLayer(
            "websocket/concurrent-handlers",
            { url: "wss://example.test/realtime" },
            { directory, mode: "replay" },
          ).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
                  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
                }),
              ),
            ),
          ),
        ),
      ),
    )
  })

  test("WebSocket replay rejects close with unconsumed events", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    await seedCassetteDirectory(directory, "websocket/early-close", [
      {
        transport: "websocket",
        open: { url: "wss://example.test/realtime", headers: {} },
        events: [{ direction: "client", kind: "text", body: "expected" }],
      },
    ])

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        return yield* Effect.exit(socket.runRaw(() => {}, { onOpen: write(new Socket.CloseEvent(1000)) }))
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorderInternal.socketLayer(
            "websocket/early-close",
            { url: "wss://example.test/realtime" },
            { directory, mode: "replay" },
          ).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
                  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
                }),
              ),
            ),
          ),
        ),
      ),
    )

    expect(failureText(exit)).toContain("closed with unconsumed events")
  })

  test("failed WebSocket runs do not write complete cassettes", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        return yield* Effect.exit(socket.runRaw(() => {}))
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorderInternal.socketLayer(
            "websocket/failed-run",
            { url: "wss://example.test/realtime" },
            { directory, mode: "record" },
          ).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("connection failed")),
                  writer: Effect.succeed(() => Effect.void),
                }),
              ),
            ),
          ),
        ),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(fs.existsSync(path.join(directory, "websocket/failed-run.json"))).toBe(false)
  })

  test("WebSocket replay preserves binary frame kinds across reconnects", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-websocket-"))
    const interaction = {
      transport: "websocket" as const,
      open: { url: "wss://example.test/binary", headers: {} },
      events: [
        {
          direction: "client" as const,
          kind: "binary" as const,
          body: Buffer.from([1, 2]).toString("base64"),
          bodyEncoding: "base64" as const,
        },
        {
          direction: "server" as const,
          kind: "binary" as const,
          body: Buffer.from([3, 4]).toString("base64"),
          bodyEncoding: "base64" as const,
        },
      ],
    }
    await seedCassetteDirectory(directory, "websocket/binary", [interaction, interaction])

    const received: number[][] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        const run = socket.runRaw(
          (message) => {
            if (typeof message === "string") throw new Error("Expected a binary WebSocket frame")
            received.push([...message])
          },
          { onOpen: write(new Uint8Array([1, 2])) },
        )
        yield* run
        yield* run
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorderInternal.socketLayer(
            "websocket/binary",
            { url: "wss://example.test/binary" },
            { directory, mode: "replay" },
          ).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
                  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
                }),
              ),
            ),
          ),
        ),
      ),
    )

    expect(received).toEqual([
      [3, 4],
      [3, 4],
    ])
  })

  test("replay returns recorded responses in order for identical requests", async () => {
    await runWith(
      "record-replay/retry",
      {},
      Effect.gen(function* () {
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
        expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"complete"}')
      }),
    )
  })

  test("replay reports cursor exhaustion when more requests are made than recorded", async () => {
    await run(
      Effect.gen(function* () {
        yield* post("https://example.test/echo", { step: 1 })
        yield* post("https://example.test/echo", { step: 2 })
        const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  test("replay validates each recorded request in order", async () => {
    await run(
      Effect.gen(function* () {
        yield* post("https://example.test/echo", { step: 1 })
        const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(failureText(exit)).toContain("$.step expected 2, received 3")
        expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
      }),
    )
  })

  test("concurrent replay claims each interaction once", async () => {
    const results = await runWith(
      "record-replay/retry",
      {},
      Effect.all(
        [post("https://example.test/poll", { id: "job_1" }), post("https://example.test/poll", { id: "job_1" })],
        { concurrency: "unbounded" },
      ),
    )

    expect(results.toSorted()).toEqual(['{"status":"complete"}', '{"status":"pending"}'])
  })

  test("replays when the cassette exists", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-auto-"))
    await seedCassetteDirectory(directory, "auto-replay", [
      {
        transport: "http",
        request: {
          method: "POST",
          url: "https://example.test/echo",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ step: 1 }),
        },
        response: { status: 200, headers: { "content-type": "application/json" }, body: '{"reply":"hi"}' },
      },
    ])

    const result = await runWith("auto-replay", { directory }, post("https://example.test/echo", { step: 1 }))
    expect(result).toBe('{"reply":"hi"}')
  })

  test("forces replay when CI=true even if cassette is missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-auto-ci-"))
    const previous = process.env.CI
    process.env.CI = "true"
    try {
      const exit = await Effect.runPromise(
        Effect.exit(
          post("https://example.test/echo", { step: 1 }).pipe(
            Effect.provide(HttpRecorder.http("missing-cassette", { directory })),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureText(exit)).toContain('Fixture "missing-cassette" not found')
    } finally {
      if (previous === undefined) delete process.env.CI
      else process.env.CI = previous
    }
  })

  test("mismatch diagnostics show redacted request differences against the expected interaction", async () => {
    await run(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          post("https://example.test/echo?api_key=secret-value", { step: 3, token: "sk-123456789012345678901234" }),
        )
        const message = failureText(exit)
        expect(message).toContain("url:")
        expect(message).toContain("https://example.test/echo?api_key=%5BREDACTED%5D")
        expect(message).toContain("body:")
        expect(message).toContain("$.step expected 1, received 3")
        expect(message).toContain('$.token expected undefined, received "[REDACTED]"')
        expect(message).not.toContain("sk-123456789012345678901234")
      }),
    )
  })

  test("records to disk when the cassette is missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-auto-record-"))
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response('{"reply":"recorded"}', { headers: { "content-type": "application/json" } }),
    })
    const url = `http://127.0.0.1:${server.port}/echo`
    // CI=true forces replay; clear it so we exercise the local-dev auto-record path.
    const previous = process.env.CI
    delete process.env.CI
    try {
      const result = await runWith("auto-record", { directory }, post(url, { step: 1 }))
      expect(result).toBe('{"reply":"recorded"}')
      expect(fs.existsSync(path.join(directory, "auto-record.json"))).toBe(true)
    } finally {
      if (previous !== undefined) process.env.CI = previous
    }
  })

  test("records concurrent requests in request-start order", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-order-"))
    const first = Promise.withResolvers<void>()
    const completed: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const name = new URL(request.url).pathname.slice(1)
        if (name === "first") {
          await first.promise
          completed.push(name)
          return new Response(name)
        }
        completed.push(name)
        first.resolve()
        return new Response(name)
      },
    })
    const previous = process.env.CI
    delete process.env.CI
    try {
      const request = (name: string) =>
        Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          const response = yield* http.execute(HttpClientRequest.get(`http://127.0.0.1:${server.port}/${name}`))
          return yield* response.text
        })
      const responses = await Effect.runPromise(
        Effect.all([request("first"), request("second")], { concurrency: "unbounded" }).pipe(
          Effect.provide(HttpRecorder.http("concurrent-order", { directory })),
        ),
      )
      const cassette = JSON.parse(fs.readFileSync(path.join(directory, "concurrent-order.json"), "utf8"))

      expect(completed).toEqual(["second", "first"])
      expect(responses).toEqual(["first", "second"])
      expect(cassette.interactions.map((interaction: Interaction) => interaction.request.url)).toEqual([
        `http://127.0.0.1:${server.port}/first`,
        `http://127.0.0.1:${server.port}/second`,
      ])
    } finally {
      if (previous !== undefined) process.env.CI = previous
    }
  })

  test("returns the live response while persisting its redacted snapshot", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-live-response-"))
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(JSON.stringify({ access_token: "live-secret", safe: true }), {
          headers: { "content-type": "application/json", "x-request-id": "request-1" },
        }),
    })
    const previous = process.env.CI
    delete process.env.CI
    try {
      const body = await runWith(
        "live-response",
        { directory },
        post(`http://127.0.0.1:${server.port}/response`, { ok: true }),
      )
      const cassette = JSON.parse(fs.readFileSync(path.join(directory, "live-response.json"), "utf8"))

      expect(body).toBe('{"access_token":"live-secret","safe":true}')
      expect(cassette.interactions[0].response.body).toBe('{"access_token":"[REDACTED]","safe":true}')
    } finally {
      if (previous !== undefined) process.env.CI = previous
    }
  })

  test("reconstructs responses with null-body statuses", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-no-content-"))
    using server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) })
    const previous = process.env.CI
    delete process.env.CI
    try {
      const program = Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        return yield* http.execute(HttpClientRequest.get(`http://127.0.0.1:${server.port}/empty`))
      })
      const response = await Effect.runPromise(
        program.pipe(Effect.provide(HttpRecorder.http("no-content", { directory }))),
      )

      expect(response.status).toBe(204)
    } finally {
      if (previous !== undefined) process.env.CI = previous
    }
  })

  test("records and replays arbitrary binary responses without changing bytes", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-binary-"))
    const expected = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x80])
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(expected, { headers: { "content-type": "image/png" } }),
    })
    const url = `http://127.0.0.1:${server.port}/image.png`
    const previous = process.env.CI
    delete process.env.CI
    try {
      const program = Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const response = yield* http.execute(HttpClientRequest.get(url))
        return new Uint8Array(yield* response.arrayBuffer)
      })
      const record = await Effect.runPromise(program.pipe(Effect.provide(HttpRecorder.http("binary", { directory }))))
      await server.stop()
      const replay = await Effect.runPromise(program.pipe(Effect.provide(HttpRecorder.http("binary", { directory }))))
      const cassette = JSON.parse(fs.readFileSync(path.join(directory, "binary.json"), "utf8"))

      expect(record).toEqual(expected)
      expect(replay).toEqual(expected)
      expect(cassette.interactions[0].response.bodyEncoding).toBe("base64")
    } finally {
      if (previous !== undefined) process.env.CI = previous
    }
  })

  test("UnsafeCassetteError fails the request when a recording would write a known secret", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("Bearer abcdefghijklmnopqrstuvwxyz1234") })
    const url = `http://127.0.0.1:${server.port}/leaky`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-unsafe-"))

    const exit = await Effect.runPromise(
      Effect.exit(
        post(url, { ok: true }).pipe(
          Effect.provide(HttpRecorderInternal.cassetteLayer("unsafe-record", { directory, mode: "record" })),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureText(exit)).toContain("contains possible secrets")
    expect(fs.existsSync(path.join(directory, "unsafe-record.json"))).toBe(false)
  })

  test("failed memory appends leave cassette state unchanged", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const cassette = yield* HttpRecorderInternal.Cassette.Service
        const interaction: Interaction = {
          transport: "http",
          request: { method: "GET", url: "https://example.test", headers: {}, body: "" },
          response: { status: 200, headers: {}, body: "safe" },
        }
        yield* cassette.append("transactional", interaction)
        yield* cassette
          .append("transactional", {
            ...interaction,
            response: { ...interaction.response, body: "Bearer abcdefghijklmnopqrstuvwxyz1234" },
          })
          .pipe(Effect.flip)

        expect(yield* cassette.read("transactional")).toEqual([interaction])
      }).pipe(Effect.provide(HttpRecorderInternal.Cassette.memory())),
    )
  })

  test("concurrent file appends preserve every interaction", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-concurrent-"))
    await Effect.runPromise(
      Effect.gen(function* () {
        const cassette = yield* HttpRecorderInternal.Cassette.Service
        yield* Effect.forEach(
          Array.from({ length: 20 }, (_, index) => index),
          (index) =>
            cassette.append("concurrent", {
              transport: "http",
              request: { method: "GET", url: `https://example.test/${index}`, headers: {}, body: "" },
              response: { status: 200, headers: {}, body: String(index) },
            }),
          { concurrency: "unbounded" },
        )
      }).pipe(
        Effect.provide(HttpRecorderInternal.Cassette.fileSystem({ directory })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )

    const cassette = JSON.parse(fs.readFileSync(path.join(directory, "concurrent.json"), "utf8"))
    expect(cassette.interactions).toHaveLength(20)
    expect(fs.readdirSync(directory).filter((file) => file.endsWith(".tmp"))).toEqual([])
  })

  test("rejects cassette paths outside the recordings directory", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-path-"))
    expect(() => HttpRecorderInternal.hasCassetteSync("../outside", { directory })).toThrow("Invalid cassette name")
    expect(() => HttpRecorderInternal.hasCassetteSync("C:\\outside", { directory })).toThrow("Invalid cassette name")
  })

  test("Cassette.list enumerates recorded cassette names", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-list-"))
    await seedCassetteDirectory(directory, "alpha/one", [
      {
        transport: "http",
        request: { method: "GET", url: "https://x.test/a", headers: {}, body: "" },
        response: { status: 200, headers: {}, body: "a" },
      },
    ])
    await seedCassetteDirectory(directory, "beta", [
      {
        transport: "http",
        request: { method: "GET", url: "https://x.test/b", headers: {}, body: "" },
        response: { status: 200, headers: {}, body: "b" },
      },
    ])

    const names = await Effect.runPromise(
      Effect.gen(function* () {
        const cassette = yield* HttpRecorderInternal.Cassette.Service
        return yield* cassette.list()
      }).pipe(
        Effect.provide(HttpRecorderInternal.Cassette.fileSystem({ directory })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(names).toEqual(["alpha/one", "beta"])
  })
})

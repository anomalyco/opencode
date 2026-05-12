import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Scope, Stream } from "effect"
import { Headers, HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { HttpRecorder } from "../src"
import { redactedErrorRequest } from "../src/effect"
import type { Interaction } from "../src/schema"

const seedCassetteDirectory = (directory: string, name: string, interactions: ReadonlyArray<Interaction>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cassette = yield* HttpRecorder.Cassette.Service
      yield* Effect.forEach(interactions, (interaction) => cassette.append(name, interaction))
    }).pipe(Effect.provide(HttpRecorder.Cassette.fileSystem({ directory })), Effect.provide(NodeFileSystem.layer)),
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
  Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.cassetteLayer("record-replay/multi-step"))))

const runWith = <A, E>(
  name: string,
  options: HttpRecorder.RecordReplayOptions,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Effect.runPromise(effect.pipe(Effect.provide(HttpRecorder.cassetteLayer(name, options))))

const runRecorder = <A, E>(effect: Effect.Effect<A, E, HttpRecorder.Cassette.Service | Scope.Scope>) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(
        Effect.provide(
          HttpRecorder.Cassette.fileSystem({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-")) }),
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
      HttpRecorder.redactUrl(
        "https://example.test/path?key=secret-google-key&api_key=secret-openai-key&safe=value&X-Amz-Signature=secret-signature",
      ),
    ).toBe(
      "https://example.test/path?key=%5BREDACTED%5D&api_key=%5BREDACTED%5D&safe=value&X-Amz-Signature=%5BREDACTED%5D",
    )
  })

  test("redacts URL credentials", () => {
    expect(HttpRecorder.redactUrl("https://user:password@example.test/path?safe=value")).toBe(
      "https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/path?safe=value",
    )
  })

  test("applies custom URL redaction after built-in redaction", () => {
    expect(
      HttpRecorder.redactUrl("https://example.test/accounts/real-account/path?key=secret-key", undefined, (url) =>
        url.replace("/accounts/real-account/", "/accounts/{account}/"),
      ),
    ).toBe("https://example.test/accounts/{account}/path?key=%5BREDACTED%5D")
  })

  test("redacts sensitive headers when allow-listed", () => {
    expect(
      HttpRecorder.redactHeaders(
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
      HttpRecorder.secretFindings({
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
      HttpRecorder.secretFindings({
        version: 1,
        metadata: { token: "sk-123456789012345678901234" },
        interactions: [],
      }),
    ).toEqual([{ path: "metadata.token", reason: "API key" }])
  })

  test("replays websocket interactions seeded into the in-memory cassette adapter", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const cassette = yield* HttpRecorder.Cassette.Service
          const executor = yield* HttpRecorder.makeWebSocketExecutor({
            name: "websocket/replay",
            cassette,
            compareClientMessagesAsJson: true,
            live: { open: () => Effect.die(new Error("unexpected live WebSocket open")) },
          })
          const connection = yield* executor.open({
            url: "wss://example.test/realtime",
            headers: Headers.fromInput({ "content-type": "application/json" }),
          })
          yield* connection.sendText(JSON.stringify({ type: "response.create" }))
          const messages: Array<string | Uint8Array> = []
          yield* connection.messages.pipe(Stream.runForEach((message) => Effect.sync(() => messages.push(message))))
          yield* connection.close

          expect(messages).toEqual([JSON.stringify({ type: "response.completed" })])
        }).pipe(
          Effect.provide(
            HttpRecorder.Cassette.memory({
              "websocket/replay": [
                {
                  transport: "websocket",
                  open: { url: "wss://example.test/realtime", headers: { "content-type": "application/json" } },
                  client: [{ kind: "text", body: JSON.stringify({ type: "response.create" }) }],
                  server: [{ kind: "text", body: JSON.stringify({ type: "response.completed" }) }],
                },
              ],
            }),
          ),
        ),
      ),
    )
  })

  test("records websocket interactions into the shared cassette service", async () => {
    await runRecorder(
      Effect.gen(function* () {
        const cassette = yield* HttpRecorder.Cassette.Service
        const executor = yield* HttpRecorder.makeWebSocketExecutor({
          name: "websocket/record",
          mode: "record",
          metadata: { provider: "test" },
          cassette,
          live: {
            open: () =>
              Effect.succeed({
                sendText: () => Effect.void,
                messages: Stream.fromIterable([JSON.stringify({ type: "response.completed" })]),
                close: Effect.void,
              }),
          },
        })
        const connection = yield* executor.open({
          url: "wss://example.test/realtime",
          headers: Headers.fromInput({ "content-type": "application/json" }),
        })
        yield* connection.sendText(JSON.stringify({ type: "response.create" }))
        yield* connection.messages.pipe(Stream.runDrain)
        yield* connection.close

        expect(yield* cassette.read("websocket/record")).toMatchObject([
          {
            transport: "websocket",
            open: { url: "wss://example.test/realtime", headers: { "content-type": "application/json" } },
            client: [{ kind: "text", body: JSON.stringify({ type: "response.create" }) }],
            server: [{ kind: "text", body: JSON.stringify({ type: "response.completed" }) }],
          },
        ])
      }),
    )
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

  test("auto mode replays when the cassette exists", async () => {
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

    const result = await runWith(
      "auto-replay",
      { directory, mode: "auto" },
      post("https://example.test/echo", { step: 1 }),
    )
    expect(result).toBe('{"reply":"hi"}')
  })

  test("auto mode forces replay when CI=true even if cassette is missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-auto-ci-"))
    const previous = process.env.CI
    process.env.CI = "true"
    try {
      const exit = await Effect.runPromise(
        Effect.exit(
          post("https://example.test/echo", { step: 1 }).pipe(
            Effect.provide(HttpRecorder.cassetteLayer("missing-cassette", { directory, mode: "auto" })),
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
})

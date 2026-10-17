import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Context, Effect, Schema, Tracer } from "effect"
import { HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"
import { ServerFetch } from "../src/fetch"
import type { ServerOptions } from "../src/options"

for (const entry of ["process", "fetch"] as const) {
  it.live(
    `${entry}: session prompts do not inherit the server startup trace`,
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped("opencode-session-tracing-")
        const prompts = ["trace-fixture-first", "trace-fixture-second", "trace-fixture-inbound"]
        const requests = new Map(prompts.map((text) => [text, Promise.withResolvers<string>()]))
        const provider = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(request) {
                const body = Schema.decodeUnknownSync(
                  Schema.Struct({
                    messages: Schema.Array(
                      Schema.Struct({
                        role: Schema.String,
                        content: Schema.Union([
                          Schema.String,
                          Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
                        ]),
                      }),
                    ),
                  }),
                )(await request.json())
                const user = body.messages.findLast((message) => message.role === "user")
                const text = Array.isArray(user?.content)
                  ? user.content.map((part) => part.text ?? "").join("")
                  : user?.content
                for (const marker of prompts) {
                  if (text === marker) requests.get(marker)!.resolve(request.headers.get("traceparent") ?? "")
                }
                return new Response(
                  'data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"chat","choices":[{"index":0,"delta":{"role":"assistant","content":"Done"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                  { headers: { "content-type": "text/event-stream" } },
                )
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        const spans: Tracer.NativeSpan[] = []
        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options)
            spans.push(span)
            return span
          },
        })
        const options: ServerOptions = {
          password: "fixture",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
          config: {
            directory: tmp.path,
            project: false,
            content: JSON.stringify({
              model: { providerID: "fixture", model: "chat" },
              providers: {
                fixture: {
                  package: "@opencode/ai/providers/openai-compatible",
                  settings: { baseURL: provider.url.toString(), apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          },
        }
        const handler = yield* (
          entry === "fetch"
            ? ServerFetch.make(options).pipe(
                Effect.map((handle) => (request: Request) => handle(request, Context.make(Tracer.Tracer, tracer))),
              )
            : ServerProcess.start<never, never>({ ...options, hostname: "127.0.0.1", port: 0 }).pipe(
                Effect.map(
                  (server) => (request: Request) =>
                    fetch(
                      new Request(
                        new URL(new URL(request.url).pathname, HttpServer.formatAddress(server.address)),
                        request,
                      ),
                    ),
                ),
              )
        ).pipe(Effect.withSpan("fixture.boot"), Effect.provideService(Tracer.Tracer, tracer))
        const post = (route: string, body: object, traceparent?: string) =>
          Effect.promise(async () => {
            const response = await handler(
              new Request(new URL(route, "http://opencode.local"), {
                method: "POST",
                headers: {
                  authorization: `Basic ${btoa("opencode:fixture")}`,
                  "content-type": "application/json",
                  ...(traceparent ? { traceparent } : {}),
                },
                body: JSON.stringify(body),
              }),
            )
            const result = await response.json()
            expect({ status: response.status, error: response.ok ? undefined : result }).toEqual({
              status: 200,
              error: undefined,
            })
            return result
          })
        const traces: string[] = []
        const inbound = "11111111111111111111111111111111"
        for (const text of prompts) {
          const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
            yield* post("/api/session", {
              // Explicit titles prevent background title generation from being mistaken for a prompt request.
              title: "Trace fixture",
              location: { directory: tmp.path },
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* post(
            `/api/session/${session.data.id}/prompt`,
            { text },
            text === prompts[2] ? `00-${inbound}-2222222222222222-01` : undefined,
          )
          const header = yield* Effect.promise(() => requests.get(text)!.promise)
          expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
          traces.push(header.split("-")[1]!)
        }
        const boot = spans.find((span) => span.name === "fixture.boot")
        expect(boot).toBeDefined()
        expect(traces[0]).not.toBe(traces[1])
        expect(traces).not.toContain(boot!.traceId)
        expect(traces[2]).toBe(inbound)
      }).pipe(Effect.timeout("20 seconds")),
    30_000,
  )
}

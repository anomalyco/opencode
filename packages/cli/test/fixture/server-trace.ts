import { Effect, Option, Tracer } from "effect"
import { HttpServer } from "effect/unstable/http"

// Match production's CLI-first module initialization before the server's dynamic import.
await import("../../src/commands/handlers/serve")
const { ServerProcess } = await import("@opencode-ai/server/process")

const spans: Tracer.NativeSpan[] = []
const tracer = Tracer.make({
  span(options) {
    const span = new Tracer.NativeSpan(options)
    spans.push(span)
    return span
  },
})
const password = "trace-test"
const authorization = `Basic ${btoa(`opencode:${password}`)}`

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: Option.some(0),
      password,
      instanceID: "trace-test",
    })
    const url = new URL("/api/health", HttpServer.formatAddress(server.address))
    const request = (traceparent?: string) =>
      Effect.promise(async () => {
        const response = await fetch(url, {
          headers: { authorization, ...(traceparent === undefined ? {} : { traceparent }) },
        })
        await response.arrayBuffer()
        if (!response.ok) throw new Error(`Health request failed with status ${response.status}`)
      })

    yield* request()
    yield* request()
    yield* request("00-11111111111111111111111111111111-2222222222222222-01")
    yield* Effect.yieldNow

    return spans
      .filter((span) => span.kind === "server" && span.attributes.get("url.path") === "/api/health")
      .map((span) => ({
        traceId: span.traceId,
        parentSpanId: Option.getOrUndefined(span.parent)?.spanId,
      }))
  }).pipe(Effect.withSpan("fixture.lifecycle"), Effect.provideService(Tracer.Tracer, tracer), Effect.scoped),
)

console.log(`TRACE_RESULT ${JSON.stringify(result)}`)

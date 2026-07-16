import { expect, test } from "bun:test"
import { Effect, Option, Tracer } from "effect"
import serve from "../src/commands/handlers/serve"

test("serve command does not create a process-wide trace parent", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })

  const result = await Effect.runPromise(
    serve({
      hostname: Option.none(),
      port: Option.none(),
      service: true,
      stdio: true,
    }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.exit),
  )

  expect(result._tag).toBe("Failure")
  expect(spans).toEqual([])
})

test("server startup does not create a process-wide trace parent", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  const { ServerProcess } = await import("@opencode-ai/server/process")

  const result = await Effect.runPromise(
    ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: Option.none(),
      password: "",
      instanceID: "test",
    }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.scoped, Effect.exit),
  )

  expect(result._tag).toBe("Failure")
  expect(spans).toEqual([])
})

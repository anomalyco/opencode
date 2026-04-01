import { NodeHttpServer } from "@effect/platform-node"
import * as Http from "node:http"
import { Deferred, Effect, Layer, ServiceMap, Stream } from "effect"
import * as HttpServer from "effect/unstable/http/HttpServer"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

type Step =
  | {
      type: "text"
      text: string
    }
  | {
      type: "tool"
      tool: string
      input: unknown
    }
  | {
      type: "fail"
      message: string
    }
  | {
      type: "hang"
    }
  | {
      type: "hold"
      text: string
      wait: PromiseLike<unknown>
    }

type Hit = {
  url: URL
  body: Record<string, unknown>
}

type Wait = {
  count: number
  ready: Deferred.Deferred<void>
}

function sse(lines: unknown[]) {
  return HttpServerResponse.stream(
    Stream.fromIterable([
      [...lines.map((line) => `data: ${JSON.stringify(line)}`), "data: [DONE]"].join("\n\n") + "\n\n",
    ]).pipe(Stream.encodeText),
    { contentType: "text/event-stream" },
  )
}

function text(step: Extract<Step, { type: "text" }>) {
  return sse([
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" } }],
    },
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [{ delta: { content: step.text } }],
    },
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [{ delta: {}, finish_reason: "stop" }],
    },
  ])
}

function tool(step: Extract<Step, { type: "tool" }>, seq: number) {
  const id = `call_${seq}`
  const args = JSON.stringify(step.input)
  return sse([
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" } }],
    },
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: "function",
                function: {
                  name: step.tool,
                  arguments: "",
                },
              },
            ],
          },
        },
      ],
    },
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: args,
                },
              },
            ],
          },
        },
      ],
    },
    {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    },
  ])
}

function fail(step: Extract<Step, { type: "fail" }>) {
  return HttpServerResponse.stream(
    Stream.fromIterable([
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}\n\n',
    ]).pipe(Stream.encodeText, Stream.concat(Stream.fail(new Error(step.message)))),
    { contentType: "text/event-stream" },
  )
}

function hang() {
  return HttpServerResponse.stream(
    Stream.fromIterable([
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}\n\n',
    ]).pipe(Stream.encodeText, Stream.concat(Stream.never)),
    { contentType: "text/event-stream" },
  )
}

function hold(step: Extract<Step, { type: "hold" }>) {
  return HttpServerResponse.stream(
    Stream.fromIterable([
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}\n\n',
    ]).pipe(
      Stream.encodeText,
      Stream.concat(
        Stream.fromEffect(Effect.promise(() => step.wait)).pipe(
          Stream.flatMap(() =>
            Stream.fromIterable([
              `data: ${JSON.stringify({
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { content: step.text } }],
              })}\n\n`,
              `data: ${JSON.stringify({
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: {}, finish_reason: "stop" }],
              })}\n\n`,
              "data: [DONE]\n\n",
            ]).pipe(Stream.encodeText),
          ),
        ),
      ),
    ),
    { contentType: "text/event-stream" },
  )
}

namespace TestLLMServer {
  export interface Service {
    readonly url: string
    readonly text: (value: string) => Effect.Effect<void>
    readonly tool: (tool: string, input: unknown) => Effect.Effect<void>
    readonly fail: (message?: string) => Effect.Effect<void>
    readonly hang: Effect.Effect<void>
    readonly hold: (text: string, wait: PromiseLike<unknown>) => Effect.Effect<void>
    readonly hits: Effect.Effect<Hit[]>
    readonly calls: Effect.Effect<number>
    readonly wait: (count: number) => Effect.Effect<void>
    readonly inputs: Effect.Effect<Record<string, unknown>[]>
    readonly pending: Effect.Effect<number>
  }
}

export class TestLLMServer extends ServiceMap.Service<TestLLMServer, TestLLMServer.Service>()("@test/LLMServer") {
  static readonly layer = Layer.effect(
    TestLLMServer,
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer
      const router = yield* HttpRouter.HttpRouter

      let hits: Hit[] = []
      let list: Step[] = []
      let seq = 0
      let waits: Wait[] = []

      const push = (step: Step) => {
        list = [...list, step]
      }

      const notify = Effect.fnUntraced(function* () {
        const ready = waits.filter((item) => hits.length >= item.count)
        if (!ready.length) return
        waits = waits.filter((item) => hits.length < item.count)
        yield* Effect.forEach(ready, (item) => Deferred.succeed(item.ready, void 0))
      })

      const pull = () => {
        const step = list[0]
        if (!step) return { step: undefined, seq }
        seq += 1
        list = list.slice(1)
        return { step, seq }
      }

      yield* router.add(
        "POST",
        "/v1/chat/completions",
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const next = pull()
          if (!next.step) return HttpServerResponse.text("unexpected request", { status: 500 })
          const json = yield* req.json.pipe(Effect.orElseSucceed(() => ({})))
          hits = [
            ...hits,
            {
              url: new URL(req.originalUrl, "http://localhost"),
              body: json && typeof json === "object" ? (json as Record<string, unknown>) : {},
            },
          ]
          yield* notify()
          if (next.step.type === "text") return text(next.step)
          if (next.step.type === "tool") return tool(next.step, next.seq)
          if (next.step.type === "fail") return fail(next.step)
          if (next.step.type === "hang") return hang()
          return hold(next.step)
        }),
      )

      yield* server.serve(router.asHttpEffect())

      return TestLLMServer.of({
        url:
          server.address._tag === "TcpAddress"
            ? `http://127.0.0.1:${server.address.port}/v1`
            : `unix://${server.address.path}/v1`,
        text: Effect.fn("TestLLMServer.text")(function* (value: string) {
          push({ type: "text", text: value })
        }),
        tool: Effect.fn("TestLLMServer.tool")(function* (tool: string, input: unknown) {
          push({ type: "tool", tool, input })
        }),
        fail: Effect.fn("TestLLMServer.fail")(function* (message = "boom") {
          push({ type: "fail", message })
        }),
        hang: Effect.gen(function* () {
          push({ type: "hang" })
        }).pipe(Effect.withSpan("TestLLMServer.hang")),
        hold: Effect.fn("TestLLMServer.hold")(function* (text: string, wait: PromiseLike<unknown>) {
          push({ type: "hold", text, wait })
        }),
        hits: Effect.sync(() => [...hits]),
        calls: Effect.sync(() => hits.length),
        wait: Effect.fn("TestLLMServer.wait")(function* (count: number) {
          if (hits.length >= count) return
          const ready = yield* Deferred.make<void>()
          waits = [...waits, { count, ready }]
          yield* Deferred.await(ready)
        }),
        inputs: Effect.sync(() => hits.map((hit) => hit.body)),
        pending: Effect.sync(() => list.length),
      })
    }),
  ).pipe(
    Layer.provide(HttpRouter.layer), //
    Layer.provide(NodeHttpServer.layer(() => Http.createServer(), { port: 0 })),
  )
}

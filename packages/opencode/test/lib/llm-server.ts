import { NodeHttpServer, NodeHttpServerRequest } from "@effect/platform-node"
import * as Http from "node:http"
import { Deferred, Effect, Layer, ServiceMap, Stream } from "effect"
import * as HttpServer from "effect/unstable/http/HttpServer"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

export type Usage = { input: number; output: number }

type Line = Record<string, unknown>

type Hit = {
  url: URL
  body: Record<string, unknown>
}

type Wait = {
  count: number
  ready: Deferred.Deferred<void>
}

type Sse = {
  type: "sse"
  head: unknown[]
  tail: unknown[]
  wait?: PromiseLike<unknown>
  hang?: boolean
  error?: unknown
  reset?: boolean
}

type HttpError = {
  type: "http-error"
  status: number
  body: unknown
}

export type Item = Sse | HttpError

const done = Symbol("done")

function line(input: unknown) {
  if (input === done) return "data: [DONE]\n\n"
  return `data: ${JSON.stringify(input)}\n\n`
}

function tokens(input?: Usage) {
  if (!input) return
  return {
    prompt_tokens: input.input,
    completion_tokens: input.output,
    total_tokens: input.input + input.output,
  }
}

function chunk(input: { delta?: Record<string, unknown>; finish?: string; usage?: Usage }) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta: input.delta ?? {},
        ...(input.finish ? { finish_reason: input.finish } : {}),
      },
    ],
    ...(input.usage ? { usage: tokens(input.usage) } : {}),
  } satisfies Line
}

function role() {
  return chunk({ delta: { role: "assistant" } })
}

function textLine(value: string) {
  return chunk({ delta: { content: value } })
}

function reasonLine(value: string) {
  return chunk({ delta: { reasoning_content: value } })
}

function finishLine(reason: string, usage?: Usage) {
  return chunk({ finish: reason, usage })
}

function toolStartLine(id: string, name: string) {
  return chunk({
    delta: {
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: {
            name,
            arguments: "",
          },
        },
      ],
    },
  })
}

function toolArgsLine(value: string) {
  return chunk({
    delta: {
      tool_calls: [
        {
          index: 0,
          function: {
            arguments: value,
          },
        },
      ],
    },
  })
}

function bytes(input: Iterable<unknown>) {
  return Stream.fromIterable([...input].map(line)).pipe(Stream.encodeText)
}

function send(item: Sse) {
  const head = bytes(item.head)
  const tail = bytes([...item.tail, ...(item.hang || item.error ? [] : [done])])
  const empty = Stream.fromIterable<Uint8Array>([])
  const wait = item.wait
  const body: Stream.Stream<Uint8Array, unknown> = wait
    ? Stream.concat(head, Stream.fromEffect(Effect.promise(() => wait)).pipe(Stream.flatMap(() => tail)))
    : Stream.concat(head, tail)
  let end: Stream.Stream<Uint8Array, unknown> = empty
  if (item.error) end = Stream.concat(empty, Stream.fail(item.error))
  else if (item.hang) end = Stream.concat(empty, Stream.never)

  return HttpServerResponse.stream(Stream.concat(body, end), { contentType: "text/event-stream" })
}

const reset = Effect.fn("TestLLMServer.reset")(function* (item: Sse) {
  const req = yield* HttpServerRequest.HttpServerRequest
  const res = NodeHttpServerRequest.toServerResponse(req)
  yield* Effect.sync(() => {
    res.writeHead(200, { "content-type": "text/event-stream" })
    for (const part of item.head) res.write(line(part))
    for (const part of item.tail) res.write(line(part))
    res.destroy(new Error("connection reset"))
  })
  yield* Effect.never
})

function fail(item: HttpError) {
  return HttpServerResponse.text(JSON.stringify(item.body), {
    status: item.status,
    contentType: "application/json",
  })
}

export class Reply {
  #head: unknown[] = [role()]
  #tail: unknown[] = []
  #usage: Usage | undefined
  #finish: string | undefined
  #wait: PromiseLike<unknown> | undefined
  #hang = false
  #error: unknown
  #reset = false
  #seq = 0

  #id() {
    this.#seq += 1
    return `call_${this.#seq}`
  }

  text(value: string) {
    this.#tail = [...this.#tail, textLine(value)]
    return this
  }

  reason(value: string) {
    this.#tail = [...this.#tail, reasonLine(value)]
    return this
  }

  usage(value: Usage) {
    this.#usage = value
    return this
  }

  wait(value: PromiseLike<unknown>) {
    this.#wait = value
    return this
  }

  stop() {
    this.#finish = "stop"
    this.#hang = false
    this.#error = undefined
    this.#reset = false
    return this
  }

  toolCalls() {
    this.#finish = "tool_calls"
    this.#hang = false
    this.#error = undefined
    this.#reset = false
    return this
  }

  tool(name: string, input: unknown) {
    const id = this.#id()
    const args = JSON.stringify(input)
    this.#tail = [...this.#tail, toolStartLine(id, name), toolArgsLine(args)]
    return this.toolCalls()
  }

  pendingTool(name: string, input: unknown) {
    const id = this.#id()
    const args = JSON.stringify(input)
    const size = Math.max(1, Math.floor(args.length / 2))
    this.#tail = [...this.#tail, toolStartLine(id, name), toolArgsLine(args.slice(0, size))]
    return this
  }

  hang() {
    this.#finish = undefined
    this.#hang = true
    this.#error = undefined
    this.#reset = false
    return this
  }

  streamError(error: unknown = "boom") {
    this.#finish = undefined
    this.#hang = false
    this.#error = error
    this.#reset = false
    return this
  }

  reset() {
    this.#finish = undefined
    this.#hang = false
    this.#error = undefined
    this.#reset = true
    return this
  }

  item(): Item {
    return {
      type: "sse",
      head: this.#head,
      tail: this.#finish ? [...this.#tail, finishLine(this.#finish, this.#usage)] : this.#tail,
      wait: this.#wait,
      hang: this.#hang,
      error: this.#error,
      reset: this.#reset,
    }
  }
}

export function reply() {
  return new Reply()
}

export function httpError(status: number, body: unknown): Item {
  return {
    type: "http-error",
    status,
    body,
  }
}

export function raw(input: {
  chunks?: unknown[]
  head?: unknown[]
  tail?: unknown[]
  wait?: PromiseLike<unknown>
  hang?: boolean
  error?: unknown
  reset?: boolean
}): Item {
  return {
    type: "sse",
    head: input.head ?? input.chunks ?? [],
    tail: input.tail ?? [],
    wait: input.wait,
    hang: input.hang,
    error: input.error,
    reset: input.reset,
  }
}

function item(input: Item | Reply) {
  return input instanceof Reply ? input.item() : input
}

namespace TestLLMServer {
  export interface Service {
    readonly url: string
    readonly push: (...input: (Item | Reply)[]) => Effect.Effect<void>
    readonly text: (value: string, opts?: { usage?: Usage }) => Effect.Effect<void>
    readonly tool: (name: string, input: unknown) => Effect.Effect<void>
    readonly toolHang: (name: string, input: unknown) => Effect.Effect<void>
    readonly reason: (value: string, opts?: { text?: string; usage?: Usage }) => Effect.Effect<void>
    readonly fail: (message?: unknown) => Effect.Effect<void>
    readonly error: (status: number, body: unknown) => Effect.Effect<void>
    readonly hang: Effect.Effect<void>
    readonly hold: (value: string, wait: PromiseLike<unknown>) => Effect.Effect<void>
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
      let list: Item[] = []
      let waits: Wait[] = []

      const queue = (...input: (Item | Reply)[]) => {
        list = [...list, ...input.map(item)]
      }

      const notify = Effect.fnUntraced(function* () {
        const ready = waits.filter((item) => hits.length >= item.count)
        if (!ready.length) return
        waits = waits.filter((item) => hits.length < item.count)
        yield* Effect.forEach(ready, (item) => Deferred.succeed(item.ready, void 0))
      })

      const pull = () => {
        const first = list[0]
        if (!first) return
        list = list.slice(1)
        return first
      }

      yield* router.add(
        "POST",
        "/v1/chat/completions",
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const next = pull()
          if (!next) return HttpServerResponse.text("unexpected request", { status: 500 })
          const body = yield* req.json.pipe(Effect.orElseSucceed(() => ({})))
          hits = [
            ...hits,
            {
              url: new URL(req.originalUrl, "http://localhost"),
              body: body && typeof body === "object" ? (body as Record<string, unknown>) : {},
            },
          ]
          yield* notify()
          if (next.type === "sse" && next.reset) {
            yield* reset(next)
            return HttpServerResponse.empty()
          }
          if (next.type === "sse") return send(next)
          return fail(next)
        }),
      )

      yield* server.serve(router.asHttpEffect())

      return TestLLMServer.of({
        url:
          server.address._tag === "TcpAddress"
            ? `http://127.0.0.1:${server.address.port}/v1`
            : `unix://${server.address.path}/v1`,
        push: Effect.fn("TestLLMServer.push")(function* (...input: (Item | Reply)[]) {
          queue(...input)
        }),
        text: Effect.fn("TestLLMServer.text")(function* (value: string, opts?: { usage?: Usage }) {
          const out = reply().text(value)
          if (opts?.usage) out.usage(opts.usage)
          queue(out.stop().item())
        }),
        tool: Effect.fn("TestLLMServer.tool")(function* (name: string, input: unknown) {
          queue(reply().tool(name, input).item())
        }),
        toolHang: Effect.fn("TestLLMServer.toolHang")(function* (name: string, input: unknown) {
          queue(reply().pendingTool(name, input).hang().item())
        }),
        reason: Effect.fn("TestLLMServer.reason")(function* (value: string, opts?: { text?: string; usage?: Usage }) {
          const out = reply().reason(value)
          if (opts?.text) out.text(opts.text)
          if (opts?.usage) out.usage(opts.usage)
          queue(out.stop().item())
        }),
        fail: Effect.fn("TestLLMServer.fail")(function* (message: unknown = "boom") {
          queue(reply().streamError(message).item())
        }),
        error: Effect.fn("TestLLMServer.error")(function* (status: number, body: unknown) {
          queue(httpError(status, body))
        }),
        hang: Effect.gen(function* () {
          queue(reply().hang().item())
        }).pipe(Effect.withSpan("TestLLMServer.hang")),
        hold: Effect.fn("TestLLMServer.hold")(function* (value: string, wait: PromiseLike<unknown>) {
          queue(reply().wait(wait).text(value).stop().item())
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
  ).pipe(Layer.provide(HttpRouter.layer), Layer.provide(NodeHttpServer.layer(() => Http.createServer(), { port: 0 })))
}

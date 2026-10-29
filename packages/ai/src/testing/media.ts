import { Context, Effect, Layer, Stream } from "effect"
import { Generation } from "../generation.js"
import type { MediaClient } from "../media-client.js"
import { AIError } from "../schema/index.js"
import { TestScript } from "./script.js"

/** A scripted reply: the response every operation returns, or the error it fails with. */
export type Response<Value> = Value | AIError

export interface TestInterface<Req extends MediaClient.RoutedRequest<Req, Event, Value>, Event, Value>
  extends MediaClient.Interface<Req, Event, Value>,
    TestScript.Controls<Req, Response<Value>> {}

/**
 * Builds one media test client. `stream` expands the response like an inline route, and `start` returns an already
 * finished generation whose token `resume` accepts.
 */
export const testLayer = <Self, Test, Req extends MediaClient.RoutedRequest<Req, Event, Value>, Event, Value>(
  service: Context.Service<Self, MediaClient.Interface<Req, Event, Value>>,
  test: Context.Service<Test, TestInterface<Req, Event, Value>>,
  input: {
    readonly name: string
    readonly responseEvents: (response: Value) => ReadonlyArray<Event>
    readonly options: TestScript.Options<Req, Response<Value>>
  },
) =>
  Layer.effectContext(
    Effect.sync(() => {
      const script = TestScript.make(input.name, input.options)
      const generations = new Map<string, Response<Value>>()
      const result = (response: Response<Value>) =>
        response instanceof AIError ? Effect.fail(response) : Effect.succeed(response)
      const completed = (id: string, response: Response<Value>) => {
        const snapshot = { id, status: response instanceof AIError ? "failed" : "completed" } as const
        return new Generation({ status: Effect.succeed(snapshot), result: result(response) }, id, snapshot)
      }
      const generate = (request: Req) => script.take(request).pipe(Effect.flatMap(result))
      const client = test.of({
        ...script.controls,
        generate,
        stream: (request) => Stream.fromIterableEffect(Effect.map(generate(request), input.responseEvents)),
        start: (request) =>
          script.take(request).pipe(
            Effect.map((response) => {
              const id = `${input.name}-${generations.size + 1}`
              generations.set(id, response)
              return completed(id, response)
            }),
          ),
        resume: (_model, token) => {
          const response = typeof token === "string" ? generations.get(token) : undefined
          if (response === undefined) return Effect.die(new Error(`${input.name} has no generation ${String(token)}`))
          return Effect.succeed(completed(String(token), response))
        },
      })
      return Context.make(service, client).pipe(Context.add(test, client))
    }),
  )

export * as TestMedia from "./media.js"

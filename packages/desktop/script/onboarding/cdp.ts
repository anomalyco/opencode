// A minimal Chrome DevTools Protocol client over one WebSocket, with flattened target sessions.
import { Option, Schema } from "effect"

export type CdpEvent = { method: string; params?: Schema.Json; sessionId?: string }

export type Cdp = Awaited<ReturnType<typeof connect>>

const Message = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.Number),
    method: Schema.optional(Schema.String),
    params: Schema.optional(Schema.Json),
    result: Schema.optional(Schema.Json),
    error: Schema.optional(Schema.Struct({ message: Schema.String })),
    sessionId: Schema.optional(Schema.String),
  }),
)

const decodeMessage = Schema.decodeUnknownOption(Message)

const Evaluation = Schema.Struct({
  result: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.Json) })),
  exceptionDetails: Schema.optional(Schema.Struct({ text: Schema.String })),
})

export async function connect(url: string) {
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error(`Could not connect to ${url}`))
  })

  const pending = new Map<number, { resolve: (value?: Schema.Json) => void; reject: (error: Error) => void }>()
  const listeners = new Set<(event: CdpEvent) => void>()
  let id = 0

  ws.onmessage = (message) => {
    const data = Option.getOrUndefined(decodeMessage(message.data))

    if (!data) return

    if (data.id === undefined) {
      const method = data.method

      if (method) listeners.forEach((listener) => listener({ method, params: data.params, sessionId: data.sessionId }))

      return
    }

    const request = pending.get(data.id)
    pending.delete(data.id)

    if (data.error) request?.reject(new Error(data.error.message))
    else request?.resolve(data.result)
  }

  ws.onclose = () => {
    pending.forEach((request) => request.reject(new Error("The DevTools connection closed")))
    pending.clear()
  }

  // Every command times out, so a paused or vanished page can never hang the recorder.
  const request = (method: string, params: Schema.Json, sessionId: string | undefined, timeout: number) =>
    new Promise<Schema.Json | undefined>((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`DevTools connection closed before ${method}`))
      const next = ++id

      const timer = setTimeout(() => {
        pending.delete(next)
        reject(new Error(`${method} did not answer within ${timeout / 1000}s`))
      }, timeout)

      pending.set(next, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      const message = { id: next, method, params }
      ws.send(JSON.stringify(sessionId ? { ...message, sessionId } : message))
    })

  return {
    async send(method: string, params: Schema.Json = {}, sessionId?: string, timeout = 15_000) {
      await request(method, params, sessionId, timeout)
    },
    /** Sends a command and decodes its result. */
    async call<S extends Schema.ConstraintDecoder<unknown>>(
      method: string,
      params: Schema.Json,
      schema: S,
      sessionId?: string,
      timeout = 15_000,
    ): Promise<S["Type"]> {
      return decode(schema, await request(method, params, sessionId, timeout), method)
    },
    on(listener: (event: CdpEvent) => void) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    close() {
      ws.close()
    },
  }
}

/** Evaluates `expression` in a page or the main process and decodes its JSON value. */
export async function evaluate<S extends Schema.ConstraintDecoder<unknown>>(
  cdp: Cdp,
  expression: string,
  schema: S,
  // A main process paused in the debugger cannot settle a promise, so code evaluated there sets `paused`.
  options: { sessionId?: string; commandLine?: boolean; paused?: boolean } = {},
): Promise<S["Type"]> {
  const evaluation = await cdp.call(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: !options.paused,
      includeCommandLineAPI: options.commandLine ?? false,
    },
    Evaluation,
    options.sessionId,
  )

  if (evaluation.exceptionDetails) throw new Error(`Evaluation failed: ${evaluation.exceptionDetails.text}`)

  return decode(schema, evaluation.result?.value, expression.slice(0, 40))
}

/** Decodes a DevTools event's parameters, or nothing when they do not match. */
export function params<S extends Schema.ConstraintDecoder<unknown>>(schema: S, event: CdpEvent): S["Type"] | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(event.params))
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: Schema.Json | undefined,
  label: string,
): S["Type"] {
  return Option.getOrThrowWith(
    Schema.decodeUnknownOption(schema)(value),
    () => new Error(`Unexpected result: ${label}`),
  )
}

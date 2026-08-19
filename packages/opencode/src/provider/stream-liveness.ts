import { ProviderError } from "./error"

export type Policy = {
  initial: number
  minimum: number
  maximum: number
  multiplier: number
  historySize: number
}

export const defaultPolicy = {
  initial: 900_000,
  minimum: 900_000,
  maximum: 1_800_000,
  multiplier: 2,
  historySize: 32,
} satisfies Policy

export type Detector = ReturnType<typeof create>

export function create(policy: Policy = defaultPolicy, now = () => performance.now()) {
  const histories = new Map<string, number[]>()

  function deadline(bucket: string) {
    const values = histories.get(bucket)
    if (!values?.length) return policy.initial
    return Math.min(policy.maximum, Math.max(policy.minimum, Math.max(...values) * policy.multiplier))
  }

  function observe(bucket: string, elapsed: number) {
    if (!Number.isFinite(elapsed) || elapsed < 0) return
    const values = histories.get(bucket) ?? []
    values.push(elapsed)
    if (values.length > policy.historySize) values.shift()
    histories.set(bucket, values)
  }

  function wrap(input: {
    response: Response
    bucket: string
    controller: AbortController
    timeout?: number | false
    stream?: boolean
  }) {
    const fixed =
      typeof input.timeout === "number" && Number.isFinite(input.timeout) ? input.timeout : undefined
    if (input.timeout === false || (fixed !== undefined && fixed <= 0)) return input.response
    if (!input.response.body) return input.response
    if (!input.stream && !input.response.headers.get("content-type")?.includes("text/event-stream")) return input.response

    const ms = fixed ?? deadline(input.bucket)
    const reader = input.response.body.getReader()
    let maximum = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const started = now()
        const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
          const id = setTimeout(() => {
            const error = new ProviderError.ResponseStreamTimeoutError(ms)
            input.controller.abort(error)
            void reader.cancel(error).catch(() => {})
            reject(error)
          }, ms)

          const read = () =>
            reader.read().then(
              (part) => {
                if (!part.done && part.value.byteLength === 0) {
                  void read()
                  return
                }
                clearTimeout(id)
                resolve(part)
              },
              (error) => {
                clearTimeout(id)
                reject(error)
              },
            )
          void read()
        })

        maximum = Math.max(maximum, now() - started)
        if (part.done) {
          observe(input.bucket, maximum)
          controller.close()
          return
        }
        controller.enqueue(part.value)
      },
      async cancel(reason) {
        input.controller.abort(reason)
        await reader.cancel(reason)
      },
    })

    return new Response(body, {
      headers: new Headers(input.response.headers),
      status: input.response.status,
      statusText: input.response.statusText,
    })
  }

  return {
    deadline,
    observe,
    wrap,
  }
}

export * as StreamLiveness from "./stream-liveness"

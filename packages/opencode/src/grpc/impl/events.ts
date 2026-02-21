import { create } from "@bufbuild/protobuf"
import { Bus } from "../../bus"
import { GlobalBus } from "../../bus/global"
import { Instance } from "../../project/instance"
import { BusEventSchema } from "../gen/opencode/v1/event_pb"
import type { BusEvent, SubscribeGlobalRequest, SubscribeRequest } from "../gen/opencode/v1/event_pb"

function event(input: unknown) {
  if (!input || typeof input !== "object") return create(BusEventSchema)
  if (!("type" in input)) return create(BusEventSchema)
  if (typeof input.type !== "string") return create(BusEventSchema)
  return create(BusEventSchema, { type: input.type })
}

async function* stream(
  signal: AbortSignal,
  setup: (push: (event: BusEvent) => void) => Promise<() => void> | (() => void),
) {
  const q: BusEvent[] = []
  let wake: (() => void) | undefined
  const stop = await setup((item) => {
    q.push(item)
    wake?.()
    wake = undefined
  })
  let done = false

  const close = () => {
    if (done) return
    done = true
    stop()
    wake?.()
    wake = undefined
  }

  signal.addEventListener("abort", close, { once: true })

  try {
    while (!signal.aborted) {
      while (q.length > 0) {
        const item = q.shift()
        if (!item) continue
        yield item
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    close()
    signal.removeEventListener("abort", close)
  }
}

export const events = {
  subscribe(req: SubscribeRequest, ctx: { signal: AbortSignal }) {
    return stream(ctx.signal, (push) =>
      Instance.provide({
        directory: req.directory,
        fn: () =>
          Bus.subscribeAll((input: unknown) => {
            push(event(input))
          }),
      }),
    )
  },
  subscribeGlobal(_req: SubscribeGlobalRequest, ctx: { signal: AbortSignal }) {
    return stream(ctx.signal, (push) => {
      const handler = (input: { payload: unknown }) => {
        push(event(input.payload))
      }
      GlobalBus.on("event", handler)
      return () => {
        GlobalBus.off("event", handler)
      }
    })
  },
}

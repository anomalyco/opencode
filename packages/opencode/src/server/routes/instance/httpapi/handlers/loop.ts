import { Loop } from "@/loop/loop"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"

export const loopHandlers = HttpApiBuilder.group(InstanceHttpApi, "loop", (handlers) =>
  Effect.gen(function* () {
    const loop = yield* Loop.Service

    const list = Effect.fn("LoopHttpApi.list")(function* (ctx: { query: { directory?: string } }) {
      return yield* loop.list({ directory: ctx.query.directory })
    })

    const get = Effect.fn("LoopHttpApi.get")(function* (ctx: { params: { loopID: Loop.LoopID } }) {
      const info = yield* loop.get(ctx.params.loopID)
      if (!info) return yield* notFound(`Loop not found: ${ctx.params.loopID}`)
      return info
    })

    const create = Effect.fn("LoopHttpApi.create")(function* (ctx: { payload: typeof Loop.CreateInput.Type }) {
      // A second queue loop over the same directory would fight the first for
      // the derived cursor and working tree — surfaced as a 400.
      return yield* loop
        .create(ctx.payload)
        .pipe(Effect.catchTag("LoopQueueActiveError", () => Effect.fail(new HttpApiError.BadRequest({}))))
    })

    const pause = Effect.fn("LoopHttpApi.pause")(function* (ctx: { params: { loopID: Loop.LoopID } }) {
      const ok = yield* loop.pause(ctx.params.loopID)
      if (!ok) return yield* notFound(`Loop not found or not running: ${ctx.params.loopID}`)
      return ok
    })

    const resume = Effect.fn("LoopHttpApi.resume")(function* (ctx: { params: { loopID: Loop.LoopID } }) {
      const ok = yield* loop.resume(ctx.params.loopID)
      if (!ok) return yield* notFound(`Loop not found or not paused: ${ctx.params.loopID}`)
      return ok
    })

    const cancel = Effect.fn("LoopHttpApi.cancel")(function* (ctx: { params: { loopID: Loop.LoopID } }) {
      const ok = yield* loop.cancel(ctx.params.loopID)
      if (!ok) return yield* notFound(`Loop not found or already finished: ${ctx.params.loopID}`)
      return ok
    })

    const nudge = Effect.fn("LoopHttpApi.nudge")(function* (ctx: {
      params: { loopID: Loop.LoopID }
      payload: { text: string }
    }) {
      const ok = yield* loop.nudge(ctx.params.loopID, ctx.payload.text)
      if (!ok) return yield* notFound(`No running loop to steer: ${ctx.params.loopID}`)
      return ok
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("create", create)
      .handle("pause", pause)
      .handle("resume", resume)
      .handle("cancel", cancel)
      .handle("nudge", nudge)
  }),
)

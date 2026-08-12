import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { RpcTest } from "effect/unstable/rpc"
import { BackendRpcs, SimulationRequestError, UiRpcs } from "../../src/simulation/rpc.js"

const state = {
  focused: { renderable: 1, editor: true },
  elements: [],
}

describe("OpenCode simulation RPC contracts", () => {
  it.effect("generates typed UI clients over the canonical schemas", () => {
    const calls: Array<{ readonly method: string; readonly payload: unknown }> = []
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(UiRpcs).pipe(
        Effect.provide(
          UiRpcs.toLayer({
            "ui.state": (payload) => {
              calls.push({ method: "ui.state", payload })
              return Effect.succeed(state)
            },
            "ui.matches": (payload) => {
              calls.push({ method: "ui.matches", payload })
              if (payload.text === "fail")
                return Effect.fail(
                  new SimulationRequestError({
                    method: "ui.matches",
                    code: -32000,
                    message: "match failed",
                  }),
                )
              return Effect.succeed(true)
            },
            "ui.screenshot": (payload) => {
              calls.push({ method: "ui.screenshot", payload })
              return Effect.succeed(`/tmp/${payload?.name ?? "screen"}.png`)
            },
            "ui.recording.finish": (payload) => {
              calls.push({ method: "ui.recording.finish", payload })
              return Effect.succeed("/tmp/recording.jsonl")
            },
            "ui.type": (payload) => {
              calls.push({ method: "ui.type", payload })
              return Effect.succeed(state)
            },
            "ui.press": () => Effect.succeed(state),
            "ui.enter": () => Effect.succeed(state),
            "ui.arrow": () => Effect.succeed(state),
            "ui.focus": () => Effect.succeed(state),
            "ui.click": () => Effect.succeed(state),
            "ui.resize": () => Effect.succeed(state),
          }),
        ),
      )

      expect(yield* client["ui.state"]()).toEqual(state)
      expect(yield* client["ui.matches"]({ text: "ready" })).toBe(true)
      const error = yield* client["ui.matches"]({ text: "fail" }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SimulationRequestError)
      expect(error).toMatchObject({
        method: "ui.matches",
        code: -32000,
        message: "match failed",
      })
      expect(yield* client["ui.screenshot"](undefined)).toBe("/tmp/screen.png")
      expect(yield* client["ui.screenshot"]({ name: "home" })).toBe("/tmp/home.png")
      expect(yield* client["ui.recording.finish"]()).toBe("/tmp/recording.jsonl")
      expect(yield* client["ui.type"]({ text: "hello" })).toEqual(state)

      expect(calls).toEqual([
        { method: "ui.state", payload: undefined },
        { method: "ui.matches", payload: { text: "ready" } },
        { method: "ui.matches", payload: { text: "fail" } },
        { method: "ui.screenshot", payload: undefined },
        { method: "ui.screenshot", payload: { name: "home" } },
        { method: "ui.recording.finish", payload: undefined },
        { method: "ui.type", payload: { text: "hello" } },
      ])
    })
  })

  it.effect("generates backend clients with optional finish reasons", () => {
    const calls: Array<{ readonly method: string; readonly payload: unknown }> = []
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(BackendRpcs).pipe(
        Effect.provide(
          BackendRpcs.toLayer({
            "llm.attach": (payload) => {
              calls.push({ method: "llm.attach", payload })
              return Effect.succeed({ attached: true as const })
            },
            "llm.chunk": (payload) => {
              calls.push({ method: "llm.chunk", payload })
              return Effect.succeed({ ok: true as const })
            },
            "llm.finish": (payload) => {
              calls.push({ method: "llm.finish", payload })
              return Effect.succeed({ ok: true as const })
            },
            "llm.disconnect": (payload) => {
              calls.push({ method: "llm.disconnect", payload })
              return Effect.succeed({ ok: true as const })
            },
          }),
        ),
      )

      expect(yield* client["llm.attach"]()).toEqual({ attached: true })
      expect(
        yield* client["llm.chunk"]({
          id: "exchange-1",
          items: [{ type: "textDelta", text: "hello" }],
        }),
      ).toEqual({ ok: true })
      expect(yield* client["llm.finish"]({ id: "exchange-1" })).toEqual({
        ok: true,
      })
      expect(
        yield* client["llm.finish"]({
          id: "exchange-2",
          reason: "length",
        }),
      ).toEqual({ ok: true })
      expect(yield* client["llm.disconnect"]({ id: "exchange-3" })).toEqual({
        ok: true,
      })

      expect(calls).toEqual([
        { method: "llm.attach", payload: undefined },
        {
          method: "llm.chunk",
          payload: {
            id: "exchange-1",
            items: [{ type: "textDelta", text: "hello" }],
          },
        },
        { method: "llm.finish", payload: { id: "exchange-1" } },
        {
          method: "llm.finish",
          payload: { id: "exchange-2", reason: "length" },
        },
        { method: "llm.disconnect", payload: { id: "exchange-3" } },
      ])
    })
  })
})

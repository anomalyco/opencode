import { describe, expect, it } from "vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { LlmControllerError } from "../../src/driver/llm-errors.js"
import * as LlmState from "../../src/driver/llm-state.js"

const completion = () =>
  Effect.runSync(Deferred.make<void, LlmControllerError>())

const request = (id: string): LlmState.AttachedRequest =>
  ({
    request: { id, url: "https://example.test", body: {} },
    backend: {} as LlmState.AttachedRequest["backend"],
  })

const handler: LlmState.ServeHandler = () => Stream.empty

describe("LlmState", () => {
  it("rejects queue/send after serve mode is selected", () => {
    const state = LlmState.serve(LlmState.initial, handler)
    expect(LlmState.rejectEnqueue(state, "queue")).toMatchObject({
      _tag: "LlmModeError",
      operation: "queue",
    })
  })

  it("rejects serve after queue mode is selected", () => {
    const state = LlmState.enqueue(LlmState.initial, { output: [] })
    expect(LlmState.rejectServe(state)).toMatchObject({
      _tag: "LlmModeError",
      operation: "serve",
    })
  })

  it("rejects control calls while settling", () => {
    const state = LlmState.beginSettling(LlmState.initial)
    expect(LlmState.rejectEnqueue(state, "send")).toMatchObject({
      _tag: "LlmControllerError",
      operation: "send",
    })
  })

  it("selects no job until a queued request has a queued response", () => {
    const requested = LlmState.pushRequest(LlmState.initial, request("r1"))
    expect(LlmState.nextNormal(requested)).toBeUndefined()

    const responded = LlmState.enqueue(requested, { output: [] })
    const start = LlmState.nextNormal(responded)
    expect(start?.request.request.id).toBe("r1")
    expect(start?.source._tag).toBe("Queued")
  })

  it("serve mode runs requests without queued responses", () => {
    const state = LlmState.pushRequest(
      LlmState.serve(LlmState.initial, handler),
      request("r1"),
    )
    expect(LlmState.nextNormal(state)?.source._tag).toBe("Served")
  })

  it("startNormal consumes the request and response and bumps the index", () => {
    const state = LlmState.enqueue(
      LlmState.pushRequest(LlmState.initial, request("r1")),
      { output: [] },
    )
    const start = LlmState.nextNormal(state)!
    const next = LlmState.startNormal(state, start, completion())
    expect(next.requests).toHaveLength(0)
    expect(next.responses).toHaveLength(0)
    expect(next.activeNormal).toHaveLength(1)
    expect(next.requestIndex).toBe(1)
    expect(LlmState.nextNormal(next)).toBeUndefined()
  })

  it("settles Done when idle, Wait while work remains, Fail on unexpected requests", () => {
    expect(LlmState.inspectSettlement(LlmState.initial)._tag).toBe("Done")

    const waiting = LlmState.enqueue(LlmState.initial, { output: [] })
    expect(LlmState.inspectSettlement(waiting)._tag).toBe("Wait")

    const unexpected = LlmState.pushRequest(
      LlmState.enqueue(LlmState.initial, { output: [] }),
      request("r1"),
    )
    const drained = LlmState.startNormal(
      unexpected,
      LlmState.nextNormal(unexpected)!,
      completion(),
    )
    const late = LlmState.pushRequest(drained, request("r2"))
    const settlement = LlmState.inspectSettlement({
      ...late,
      activeNormal: [],
    })
    expect(settlement).toMatchObject({
      _tag: "Fail",
      error: { _tag: "LlmSettlementError", unexpectedRequests: 1 },
    })
  })

  it("records only the first failure and keeps it", () => {
    const error = (message: string) =>
      new LlmControllerError({ operation: "test", message })
    const first = LlmState.recordFailure(LlmState.initial, error("first"))
    expect(first[1].isFirst).toBe(true)
    const second = LlmState.recordFailure(first[0], error("second"))
    expect(second[1].isFirst).toBe(false)
    expect(second[1].failure).toBe(first[1].failure)
  })
})

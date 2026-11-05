import { afterEach, describe, expect, jest, test } from "bun:test"
import { uploads } from "./uploads"
import {
  INITIAL_UPLOAD_MACHINE_STATE,
  UPLOAD_STALL_TIMEOUT_MS,
  UPLOAD_TIMED_OUT,
  transitionUploads,
  type UploadMachineEvent,
  type UploadMachineState,
  type UploadMachineTransition,
  type UploadScope,
} from "./upload-machine"

const scopeA = {}

const scopeB = {}

function start(id: string, scope: UploadScope): UploadMachineEvent {
  return { type: "upload.started", id, scope, filename: `${id}.bin`, mime: "application/octet-stream", size: 1024 }
}

function replay(events: UploadMachineEvent[], state: UploadMachineState = INITIAL_UPLOAD_MACHINE_STATE) {
  const initial: UploadMachineTransition = { state, effects: [] }

  return events.reduce((result, event) => transitionUploads(result.state, event), initial)
}

afterEach(() => {
  jest.useRealTimers()
})

describe("transitionUploads", () => {
  test("a queued upload has no stall timer until its first progress event, then only forward progress resets it", () => {
    const queued = replay([start("u1", scopeA)])

    expect(queued.effects).toEqual([{ type: "upload.run", attempt: 1 }])
    expect(transitionUploads(queued.state, { type: "upload.timed-out", attempt: 1 }).state).toBe(queued.state)

    const connected = replay([{ type: "upload.progress", attempt: 1, loaded: 0 }], queued.state)

    expect(connected.state).toMatchObject({ entries: [{ id: "u1", loaded: 0, transfer: "sending" }] })
    expect(connected.effects).toEqual([{ type: "timer.reset", attempt: 1, timeoutMs: UPLOAD_STALL_TIMEOUT_MS }])

    const progressed = replay([{ type: "upload.progress", attempt: 1, loaded: 512 }], connected.state)

    expect(progressed.effects).toEqual([{ type: "timer.reset", attempt: 1, timeoutMs: UPLOAD_STALL_TIMEOUT_MS }])
    expect(transitionUploads(progressed.state, { type: "upload.progress", attempt: 1, loaded: 256 }).state).toBe(
      progressed.state,
    )

    expect(transitionUploads(progressed.state, { type: "upload.timed-out", attempt: 1 })).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [
        { type: "upload.abort", attempt: 1 },
        { type: "upload.reject", attempt: 1, error: UPLOAD_TIMED_OUT },
      ],
    })
  })

  test("a fully sent body waits for the server's answer without a stall timer", () => {
    const sending = replay([start("u1", scopeA), { type: "upload.progress", attempt: 1, loaded: 512 }])
    const sent = replay([{ type: "upload.progress", attempt: 1, loaded: 4096 }], sending.state)

    expect(sent.state).toMatchObject({ entries: [{ id: "u1", loaded: 1024, transfer: "sent" }] })
    expect(sent.effects).toEqual([{ type: "timer.clear", attempt: 1 }])
    expect(transitionUploads(sent.state, { type: "upload.timed-out", attempt: 1 }).state).toBe(sent.state)
    expect(transitionUploads(sent.state, { type: "upload.succeeded", attempt: 1, path: "/tmp/u1.bin" })).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "upload.resolve", attempt: 1, path: "/tmp/u1.bin" }],
    })
  })

  test("closing a draft cancels only that draft's uploads", () => {
    const result = replay([start("u1", scopeA), start("u2", scopeB), { type: "scope.cancelled", scope: scopeA }])

    expect(result.state).toMatchObject({ status: "uploading", entries: [{ id: "u2", scope: scopeB }] })
    expect(result.effects).toEqual([
      { type: "upload.abort", attempt: 1 },
      { type: "upload.resolve", attempt: 1, path: undefined },
    ])
  })

  test("a result for an upload that was cancelled or already settled is ignored", () => {
    const cancelled = replay([start("u1", scopeA), { type: "upload.cancelled", id: "u1" }])

    expect(cancelled.state).toEqual({ status: "idle", issued: 1 })
    expect(transitionUploads(cancelled.state, { type: "upload.failed", attempt: 1, error: new Error("x") }).state).toBe(
      cancelled.state,
    )
    expect(transitionUploads(cancelled.state, { type: "upload.cancelled", id: "u1" }).state).toBe(cancelled.state)
  })
})

describe("uploads", () => {
  test("cancelling an upload drops it even when its work never settles", async () => {
    const pending = uploads.track(
      { id: "stalled", scope: scopeA, filename: "image.png", mime: "image/png", size: 1024 },
      () => new Promise<string>(() => {}),
    )

    expect(uploads.items().map((item) => item.id)).toEqual(["stalled"])
    uploads.items()[0]?.cancel()

    expect(await pending).toBeUndefined()
    expect(uploads.items()).toEqual([])
  })

  test("an upload whose body stops advancing fails after the stall timeout instead of blocking sends", async () => {
    jest.useFakeTimers()

    const pending = uploads.track(
      { id: "hung", scope: scopeB, filename: "big.zip", mime: "application/zip", size: 1024 },
      (report) => {
        report(100)

        return new Promise<string>(() => {})
      },
    )

    expect(uploads.forScope(scopeB).map((item) => item.id)).toEqual(["hung"])
    expect(uploads.forScope(scopeA)).toEqual([])
    jest.advanceTimersByTime(UPLOAD_STALL_TIMEOUT_MS)

    await expect(pending).rejects.toBe(UPLOAD_TIMED_OUT)
    expect(uploads.forScope(scopeB)).toEqual([])
  })
})

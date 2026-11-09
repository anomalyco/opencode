import { describe, expect, test } from "bun:test"
import {
  transitionWorkerRpcClient,
  transitionWorkerRpcServer,
  type RpcRequest,
  type WorkerRpcClientEvent,
  type WorkerRpcClientState,
  type WorkerRpcClientTransition,
  type WorkerRpcServerEvent,
  type WorkerRpcServerState,
  type WorkerRpcServerTransition,
} from "./worker-rpc-machine"

const live: WorkerRpcClientState = { status: "live", pending: new Set() }

const idle: WorkerRpcServerState = { status: "idle", attempt: 0 }

const request = (id: number, method = "echo", key?: string): RpcRequest => ({ id, method, key, input: id })

const requested = (id: number, aborted = false): WorkerRpcClientEvent => ({
  type: "call.requested",
  request: request(id),
  transfer: [],
  aborted,
})

// Folds the events in order and returns the last transition.
const client = (events: readonly WorkerRpcClientEvent[], state: WorkerRpcClientState = live) =>
  events.reduce<WorkerRpcClientTransition>((last, event) => transitionWorkerRpcClient(last.state, event), {
    state,
    effects: [],
  })

const server = (events: readonly WorkerRpcServerEvent[], state: WorkerRpcServerState = idle) =>
  events.reduce<WorkerRpcServerTransition>((last, event) => transitionWorkerRpcServer(last.state, event), {
    state,
    effects: [],
  })

describe("transitionWorkerRpcServer", () => {
  test("a reply that cannot be posted still answers the caller and the queue runs the next call", () => {
    const running = server([
      { type: "request.received", request: request(1, "paint") },
      { type: "request.received", request: request(2) },
      { type: "turn.ready", attempt: 1 },
    ])

    const bitmap = new ArrayBuffer(8)

    const replied = transitionWorkerRpcServer(running.state, {
      type: "handler.succeeded",
      attempt: 2,
      value: bitmap,
      transfer: [bitmap],
    })

    expect(replied).toEqual({
      state: { status: "yielding", attempt: 3, queue: [request(2)] },
      effects: [
        { type: "reply", response: { id: 1, ok: true, value: bitmap, transferred: [bitmap] }, transfer: [bitmap] },
        { type: "schedule-turn", attempt: 3 },
      ],
    })

    const failed = transitionWorkerRpcServer(replied.state, {
      type: "reply.failed",
      id: 1,
      message: "DataCloneError",
      transferred: [bitmap],
    })

    expect(failed).toEqual({
      state: replied.state,
      effects: [
        { type: "close-bitmaps", transferred: [bitmap] },
        { type: "reply", response: { id: 1, ok: false, superseded: false, message: "DataCloneError" }, transfer: [] },
      ],
    })
    expect(transitionWorkerRpcServer(failed.state, { type: "turn.ready", attempt: 3 }).effects).toEqual([
      { type: "run-handler", attempt: 4, request: request(2) },
    ])
  })

  test("an unknown method answers with an error and leaves no call running while the next one yields", () => {
    const running = server([
      { type: "request.received", request: request(1, "missing") },
      { type: "request.received", request: request(2) },
      { type: "turn.ready", attempt: 1 },
    ])

    expect(running.effects).toEqual([{ type: "run-handler", attempt: 2, request: request(1, "missing") }])

    const failed = transitionWorkerRpcServer(running.state, {
      type: "handler.failed",
      attempt: 2,
      message: "Unknown method missing",
    })

    expect(failed).toEqual({
      state: { status: "yielding", attempt: 3, queue: [request(2)] },
      effects: [
        {
          type: "reply",
          response: { id: 1, ok: false, superseded: false, message: "Unknown method missing" },
          transfer: [],
        },
        { type: "schedule-turn", attempt: 3 },
      ],
    })

    // The finished call's late cancel aborts nothing.
    const cancelled = transitionWorkerRpcServer(failed.state, { type: "cancel.received", id: 1 })

    expect(cancelled.state).toBe(failed.state)
    expect(cancelled.effects).toEqual([])
    expect(server([{ type: "handler.failed", attempt: 3, message: "late" }], failed.state).state).toBe(failed.state)
  })

  test("the last call to finish leaves the worker idle", () => {
    const done = server([
      { type: "request.received", request: request(1) },
      { type: "turn.ready", attempt: 1 },
      { type: "handler.succeeded", attempt: 2, value: 1, transfer: [] },
    ])

    expect(done).toEqual({
      state: { status: "idle", attempt: 2 },
      effects: [{ type: "reply", response: { id: 1, ok: true, value: 1, transferred: [] }, transfer: [] }],
    })
  })

  test("a newer call with the same key replaces a queued one but never the one that runs", () => {
    const yielding = server([
      { type: "request.received", request: request(1, "echo", "a") },
      { type: "request.received", request: request(2, "echo", "a") },
    ])

    expect(yielding).toEqual({
      state: { status: "yielding", attempt: 1, queue: [request(2, "echo", "a")] },
      effects: [
        {
          type: "reply",
          response: { id: 1, ok: false, superseded: true, message: "Replaced by a newer call" },
          transfer: [],
        },
      ],
    })

    const running = server(
      [
        { type: "turn.ready", attempt: 1 },
        { type: "request.received", request: request(3, "echo", "a") },
      ],
      yielding.state,
    )

    expect(running).toEqual({
      state: {
        status: "running",
        attempt: 2,
        request: request(2, "echo", "a"),
        cancelled: false,
        queue: [request(3, "echo", "a")],
      },
      effects: [],
    })
  })

  test("cancelling the only queued call goes idle, and its turn no longer runs anything", () => {
    const cancelled = server([
      { type: "request.received", request: request(1) },
      { type: "cancel.received", id: 1 },
    ])

    expect(cancelled).toEqual({ state: { status: "idle", attempt: 1 }, effects: [] })

    const stale = transitionWorkerRpcServer(cancelled.state, { type: "turn.ready", attempt: 1 })

    expect(stale.state).toBe(cancelled.state)
    expect(stale.effects).toEqual([])

    // A new call claims a new turn; the old timer stays stale.
    const next = server(
      [
        { type: "request.received", request: request(2) },
        { type: "turn.ready", attempt: 1 },
      ],
      cancelled.state,
    )

    expect(next.state).toEqual({ status: "yielding", attempt: 2, queue: [request(2)] })
  })

  test("a cancelled running call aborts once, closes its bitmaps instead of replying, and the queue moves on", () => {
    const running = server([
      { type: "request.received", request: request(1, "paint") },
      { type: "turn.ready", attempt: 1 },
      { type: "request.received", request: request(2) },
    ])

    const aborted = transitionWorkerRpcServer(running.state, { type: "cancel.received", id: 1 })

    expect(aborted.effects).toEqual([{ type: "abort-handler", attempt: 2 }])
    expect(transitionWorkerRpcServer(aborted.state, { type: "cancel.received", id: 1 }).state).toBe(aborted.state)

    const bitmap = new ArrayBuffer(8)

    expect(
      transitionWorkerRpcServer(aborted.state, {
        type: "handler.succeeded",
        attempt: 2,
        value: bitmap,
        transfer: [bitmap],
      }),
    ).toEqual({
      state: { status: "yielding", attempt: 3, queue: [request(2)] },
      effects: [
        { type: "close-bitmaps", transferred: [bitmap] },
        { type: "schedule-turn", attempt: 3 },
      ],
    })
    expect(
      transitionWorkerRpcServer(aborted.state, { type: "handler.failed", attempt: 2, message: "aborted" }),
    ).toEqual({
      state: { status: "yielding", attempt: 3, queue: [request(2)] },
      effects: [{ type: "schedule-turn", attempt: 3 }],
    })
  })

  test("a cancel withdraws a queued call behind the running one", () => {
    const running = server([
      { type: "request.received", request: request(1) },
      { type: "turn.ready", attempt: 1 },
      { type: "request.received", request: request(2) },
      { type: "cancel.received", id: 2 },
    ])

    expect(running.state).toEqual({ status: "running", attempt: 2, request: request(1), cancelled: false, queue: [] })
    expect(running.effects).toEqual([])
  })
})

describe("transitionWorkerRpcClient", () => {
  test("a caller's abort rejects as aborted and cancels the call; a close rejects as closed", () => {
    const aborted = client([requested(1), requested(2), { type: "call.aborted", id: 1 }])

    expect(aborted).toEqual({
      state: { status: "live", pending: new Set([2]) },
      effects: [
        { type: "reject-calls", ids: [1], reason: { kind: "aborted" } },
        { type: "post-cancel", id: 1 },
      ],
    })

    const closed = transitionWorkerRpcClient(aborted.state, { type: "closed" })

    expect(closed).toEqual({
      state: { status: "closed", failure: { kind: "closed", message: "The Office engine was closed" } },
      effects: [
        { type: "terminate-worker" },
        { type: "reject-calls", ids: [2], reason: { kind: "closed", message: "The Office engine was closed" } },
      ],
    })

    // Cleanup that aborts after the close posts nothing to the terminated worker.
    const late = transitionWorkerRpcClient(closed.state, { type: "call.aborted", id: 2 })

    expect(late.state).toBe(closed.state)
    expect(late.effects).toEqual([])
  })

  test("a crash rejects the pending calls as crashed, tells the viewer once, and fails later calls", () => {
    const crashed = client([requested(1), { type: "worker.crashed", message: "boom" }])

    expect(crashed).toEqual({
      state: { status: "closed", failure: { kind: "crashed", message: "boom" } },
      effects: [
        { type: "terminate-worker" },
        { type: "reject-calls", ids: [1], reason: { kind: "crashed", message: "boom" } },
        { type: "notify-crash" },
      ],
    })
    expect(transitionWorkerRpcClient(crashed.state, { type: "worker.crashed", message: "again" }).effects).toEqual([])
    expect(transitionWorkerRpcClient(crashed.state, requested(2)).effects).toEqual([
      { type: "reject-calls", ids: [2], reason: { kind: "crashed", message: "boom" } },
    ])
  })

  test("a request that cannot be posted rejects that call alone and keeps the worker", () => {
    const failed = client([requested(1), requested(2), { type: "call.post-failed", id: 2, message: "detached" }])

    expect(failed).toEqual({
      state: { status: "live", pending: new Set([1]) },
      effects: [{ type: "reject-calls", ids: [2], reason: { kind: "error", message: "detached" } }],
    })
    expect(transitionWorkerRpcClient(failed.state, requested(3)).effects).toEqual([
      { type: "post-request", request: request(3), transfer: [] },
    ])
  })

  test("a signal that already aborted rejects without posting", () => {
    expect(client([requested(1, true)])).toEqual({
      state: live,
      effects: [{ type: "reject-calls", ids: [1], reason: { kind: "aborted" } }],
    })
  })

  test("replies settle their own call, and a reply nobody waits for closes its bitmaps", () => {
    const bitmap = new ArrayBuffer(8)

    const resolved = client([
      requested(1),
      requested(2),
      { type: "reply.received", response: { id: 1, ok: true, value: "one", transferred: [] } },
      { type: "reply.received", response: { id: 2, ok: false, superseded: true, message: "Replaced" } },
    ])

    expect(resolved).toEqual({
      state: { status: "live", pending: new Set() },
      effects: [{ type: "reject-calls", ids: [2], reason: { kind: "superseded", message: "Replaced" } }],
    })

    const crossed = transitionWorkerRpcClient(resolved.state, {
      type: "reply.received",
      response: { id: 1, ok: true, value: bitmap, transferred: [bitmap] },
    })

    expect(crossed.state).toBe(resolved.state)
    expect(crossed.effects).toEqual([{ type: "close-bitmaps", transferred: [bitmap] }])

    const closed = client([{ type: "closed" }])

    expect(
      transitionWorkerRpcClient(closed.state, {
        type: "reply.received",
        response: { id: 1, ok: true, value: bitmap, transferred: [bitmap] },
      }).effects,
    ).toEqual([{ type: "close-bitmaps", transferred: [bitmap] }])
  })
})

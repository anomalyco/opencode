import { afterAll, describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"
import type { rpc } from "../fixture/rpc-worker"

const worker = new Worker(new URL("../fixture/rpc-worker.ts", import.meta.url))
const client = Rpc.client<typeof rpc>(worker)

afterAll(() => worker.terminate())

// The protocol has no timeout of its own, so a call is raced against one here:
// an unanswered request then fails the assertion instead of stalling the test.
const settle = (call: Promise<unknown>) =>
  Promise.race([
    call.then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    ),
    Bun.sleep(2000).then(() => "no reply"),
  ])

describe("util.rpc", () => {
  test("resolves with the worker's result", async () => {
    expect(await settle(client.call("echo", "hello"))).toEqual({ value: "hello" })
  })

  test("rejects when the worker's method throws", async () => {
    expect(await settle(client.call("throws", undefined))).toEqual({ error: "thrown in the worker" })
  })

  test("rejects with the cause's message when the error has none of its own", async () => {
    expect(await settle(client.call("wrapped", undefined))).toEqual({ error: "the cause says why" })
  })

  test("rejects when the worker's method rejects, and keeps serving", async () => {
    expect(await settle(client.call("rejects", undefined))).toEqual({ error: "rejected in the worker" })
    expect(await settle(client.call("echo", "still there"))).toEqual({ value: "still there" })
  })
})

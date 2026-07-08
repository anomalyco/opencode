import { describe, expect, test } from "bun:test"
import { beginConnect, clearConnect, connectFlow, consumeConnect } from "./connect-flow"

describe("connect-flow", () => {
  test("injects the request id into the broker url, overwriting any supplied value", () => {
    const url = beginConnect("my-helper://connect?devpod=x&request=attacker")
    const parsed = new URL(url)
    const request = parsed.searchParams.get("request")
    expect(request).toBeTruthy()
    expect(request).not.toBe("attacker")
    expect(parsed.searchParams.get("devpod")).toBe("x")
    clearConnect()
  })

  test("marks the flow pending, then clears on consume", () => {
    const url = beginConnect("my-helper://connect")
    expect(connectFlow.state()?.status).toBe("pending")
    const request = new URL(url).searchParams.get("request")!
    expect(consumeConnect(request)).toBe(true)
    expect(connectFlow.state()).toBeUndefined()
  })

  test("consumes exactly once and rejects mismatches", () => {
    const url = beginConnect("my-helper://connect")
    const request = new URL(url).searchParams.get("request")!
    expect(consumeConnect("wrong")).toBe(false)
    expect(consumeConnect(request)).toBe(true)
    expect(consumeConnect(request)).toBe(false)
  })

  test("rejects an empty request and any callback with no pending connect", () => {
    clearConnect()
    expect(consumeConnect("anything")).toBe(false)
    expect(consumeConnect("")).toBe(false)
  })

  test("does not enter the pending state when the broker url is invalid", () => {
    clearConnect()
    const url = beginConnect("not a url")
    expect(url).toBe("not a url")
    expect(connectFlow.state()).toBeUndefined()
    // No pending request was recorded, so no callback can be honored.
    expect(consumeConnect("anything")).toBe(false)
  })
})

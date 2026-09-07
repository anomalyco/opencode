import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createConnectionSync, reconnectOrder } from "./connection"

test("invalidates disconnected data and synchronizes after the handshake", () => {
  const calls: string[] = []
  const dispose = createRoot((dispose) => {
    const [status, setStatus] = createSignal<"connecting" | "connected" | "reconnecting">("connecting")
    const connection = createConnectionSync({
      status,
      invalidate: () => calls.push("invalidate"),
      connected: () => calls.push("connected"),
    })

    connection.handleEvent({ type: "server.connected" })
    expect(calls).toContain("connected")
    setStatus("connected")
    return dispose
  })
  dispose()
})

test("held directories refresh before the rest, otherwise keeping their order", () => {
  const held = new Set(["/b", "/d"])
  expect(reconnectOrder(["/a", "/b", "/c", "/d"], (directory) => held.has(directory))).toEqual(["/b", "/d", "/a", "/c"])
  expect(reconnectOrder(["/a", "/c"], (directory) => held.has(directory))).toEqual(["/a", "/c"])
})

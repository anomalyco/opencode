import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createConnectionSync } from "./connection"

test("invalidates disconnected data and synchronizes after the handshake", () => {
  const calls: string[] = []
  const dispose = createRoot((dispose) => {
    const [status, setStatus] = createSignal<"connecting" | "connected" | "reconnecting">("connecting")
    const connection = createConnectionSync({
      status,
      invalidate: () => calls.push("invalidate"),
      connected: () => calls.push("connected"),
    })

    connection.handleEvent({ type: "server.connected", directory: "global" })
    expect(calls).toContain("connected")
    connection.handleEvent({ type: "server.connected", directory: "/repo" })
    expect(calls.filter((call) => call === "connected")).toHaveLength(1)
    setStatus("connected")
    return dispose
  })
  dispose()
})

import { expect, test } from "bun:test"
import { createNewSessionMcps } from "./controller"

const servers = [
  { id: "b", name: "b", status: "connected" },
  { id: "a", name: "a", status: "disabled" },
  { id: "c", name: "c", status: "needs_auth" },
]

test("a server starts enabled unless disabled, and an explicit choice wins", () => {
  const mcps = createNewSessionMcps({
    servers: () => servers,
    states: () => ({ a: true, b: false }),
    pending: () => false,
    change: () => undefined,
  })

  expect(mcps.items().map((server) => server.id)).toEqual(["a", "b", "c"])
  expect(servers.map((server) => mcps.enabled(server))).toEqual([false, true, true])
  expect(mcps.count()).toBe(2)
})

import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { createSessionPlacementStore } from "./session-placement"

describe("session placement", () => {
  const local = ServerConnection.Key.make("http://localhost:4096")
  const remote = ServerConnection.Key.make("https://example.com")

  test("aliases a leaf and root without crossing servers", () => {
    const store = createSessionPlacementStore()
    store.set({ server: local, leafID: "child", rootID: "root", directory: "/repo" })
    store.set({ server: remote, leafID: "child", rootID: "other", directory: "/remote" })

    expect(store.get(local, "child")).toEqual({ rootID: "root", directory: "/repo" })
    expect(store.get(local, "root")).toEqual({ rootID: "root", directory: "/repo" })
    expect(store.get(remote, "child")).toEqual({ rootID: "other", directory: "/remote" })
  })

  test("inherits known placement for in-app child navigation", () => {
    const store = createSessionPlacementStore()
    store.set({ server: local, leafID: "parent", rootID: "root", directory: "/repo" })

    expect(store.inherit(local, "parent", "child")).toEqual({ rootID: "root", directory: "/repo" })
    expect(store.get(local, "child")).toEqual({ rootID: "root", directory: "/repo" })
    expect(store.inherit(local, "missing", "unknown")).toBeUndefined()
  })

  test("bounds retained placement aliases", () => {
    const store = createSessionPlacementStore()
    for (let index = 0; index < 300; index++) {
      store.set({ server: local, leafID: `leaf-${index}`, rootID: `root-${index}`, directory: `/repo/${index}` })
    }

    expect(store.size()).toBeLessThanOrEqual(256)
    expect(store.get(local, "leaf-0")).toBeUndefined()
    expect(store.get(local, "leaf-299")).toEqual({ rootID: "root-299", directory: "/repo/299" })
  })
})

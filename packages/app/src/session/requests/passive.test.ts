import { expect, test } from "bun:test"
import type { Data } from "@opencode/client/solid"
import type { LocationRef } from "@opencode/client/promise"
import type { ServerSDK } from "@/runtime/server/client"
import { permissionLocations, syncInactiveSession } from "./passive"

function fixture() {
  const state = {
    location: { directory: "C:\\fixture\\current\\", workspaceID: "workspace" } as LocationRef,
    loaded: [] as LocationRef[],
    running: false,
    runningChild: false,
    queueOnSync: false,
    pending: [] as { type: string }[],
    fail: false,
    hydrated: [] as string[],
  }
  const sdk = {
    api: {
      location: {
        list: async () => {
          if (state.fail) throw new Error("inventory unavailable")
          return state.loaded
        },
      },
      session: { active: async () => ({}) },
    },
  } as unknown as ServerSDK
  const data = {
    session: {
      sync: async () => {},
      get: () => ({ location: state.location }),
      family: () => (state.runningChild ? ["child"] : []),
      status: (id: string) => (state.running || (state.runningChild && id === "child") ? "running" : "idle"),
      list: () => {
        throw new Error("historical sessions must not be enumerated")
      },
      pending: {
        sync: async () => {
          if (state.queueOnSync) state.pending = [{ type: "prompt" }]
        },
        list: () => state.pending,
      },
      permission: {
        sync: async () => {
          state.hydrated.push("permission")
        },
      },
      form: {
        sync: async () => {
          state.hydrated.push("form")
        },
      },
    },
  } as unknown as Data
  return { state, sdk, data, id: "idle", current: () => true }
}

test("historical tabs do not hydrate attention", async () => {
  const input = fixture()
  await syncInactiveSession(input)
  expect(input.state.hydrated).toEqual([])
})

test("exact loaded locations and running sessions hydrate attention", async () => {
  const loaded = fixture()
  loaded.state.loaded = [{ directory: "c:/fixture/current" }]
  await syncInactiveSession(loaded)
  expect(loaded.state.hydrated).toEqual([])
  loaded.state.loaded = [{ directory: "c:/fixture/current", workspaceID: "other" }]
  await syncInactiveSession(loaded)
  expect(loaded.state.hydrated).toEqual([])
  loaded.state.loaded = [{ directory: "c:/fixture/current", workspaceID: "workspace" }]
  await syncInactiveSession(loaded)
  expect(loaded.state.hydrated).toEqual(["permission", "form"])
  const running = fixture()
  running.state.running = true
  running.state.fail = true
  await syncInactiveSession(running)
  expect(running.state.hydrated).toEqual(["permission", "form"])
  const descendant = fixture()
  descendant.state.runningChild = true
  descendant.state.fail = true
  await syncInactiveSession(descendant)
  expect(descendant.state.hydrated).toEqual(["permission", "form"])
  const queued = fixture()
  queued.state.queueOnSync = true
  queued.state.fail = true
  await syncInactiveSession(queued)
  expect(queued.state.hydrated).toEqual(["permission", "form"])
})

test("failed inventories never fall back to historical locations", async () => {
  const input = fixture()
  input.state.fail = true
  await expect(syncInactiveSession(input)).rejects.toThrow("inventory unavailable")
  expect(input.state.hydrated).toEqual([])
  expect(await permissionLocations(input)).toEqual({ locations: [], complete: false })
})

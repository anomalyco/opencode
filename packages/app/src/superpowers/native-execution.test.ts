import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import { createExecutionModel } from "./model"
import { runFixture } from "./fixtures"
import {
  createNativeExecutionAdapter,
  nativeState,
  type NativeBoundary,
  type NativeExecutionAdapter,
  type NativeScope,
  type NativeSnapshot,
} from "./native-adapter"
import { createNativeExecutionOwner } from "./native-execution"

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function rootAsync(assert: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      assert().then(
        () => {
          dispose()
          resolve()
        },
        (error) => {
          dispose()
          reject(error)
        },
      )
    })
  })
}

const nativeScope = (rootSessionID: string): NativeScope => ({
  serverKey: ServerConnection.Key.make("wsl"),
  ownerDirectory: "/root/git/demo",
  rootSessionID,
})

const emptySnapshot = (rootSessionID: string, complete: boolean): NativeSnapshot => ({
  scope: nativeScope(rootSessionID),
  rootSessionID,
  nodes: [],
  complete,
})

test("a late snapshot from a previous scope never overwrites the active scope", () =>
  rootAsync(async () => {
    const [scope, setScope] = createSignal(nativeScope("root-a"))
    const started: string[] = []
    const resolved: Array<(snapshot: NativeSnapshot) => void> = []
    const adapters: Array<{ disposed: boolean }> = []
    const owner = createNativeExecutionOwner({
      scope,
      selectedSessionID: () => scope().rootSessionID,
      createAdapter: (target) => {
        started.push(target.selectedSessionID)
        const entry = { disposed: false }
        adapters.push(entry)
        const pending = new Promise<NativeSnapshot>((resolve) => resolved.push(resolve))
        return {
          snapshot: () => emptySnapshot(target.selectedSessionID, true),
          hydrate: () => pending,
          openSession: () => "",
          dispose: () => {
            entry.disposed = true
          },
        } satisfies NativeExecutionAdapter
      },
    })
    owner.refresh()
    await settle()
    setScope(nativeScope("root-b"))
    owner.refresh()
    await settle()
    expect(started).toEqual(["root-a", "root-b"])
    expect(adapters[0]?.disposed).toBe(true)

    resolved[1]?.(emptySnapshot("root-b", true))
    await settle()
    expect(owner.snapshot()?.rootSessionID).toBe("root-b")

    resolved[0]?.(emptySnapshot("root-a", true))
    await settle()
    expect(owner.snapshot()?.rootSessionID).toBe("root-b")
    expect(adapters[1]?.disposed).toBe(false)
  }))

test("a disposed owner ignores a late snapshot", () =>
  rootAsync(async () => {
    const resolved: Array<(snapshot: NativeSnapshot) => void> = []
    const owner = createNativeExecutionOwner({
      scope: () => nativeScope("root"),
      selectedSessionID: () => "root",
      createAdapter: (target) => {
        const pending = new Promise<NativeSnapshot>((resolve) => resolved.push(resolve))
        return {
          snapshot: () => emptySnapshot(target.selectedSessionID, true),
          hydrate: () => pending,
          openSession: () => "",
          dispose: () => undefined,
        } satisfies NativeExecutionAdapter
      },
    })
    owner.refresh()
    await settle()
    owner.dispose()
    resolved[0]?.(emptySnapshot("root", true))
    await settle()
    expect(owner.snapshot()).toBeUndefined()
  }))

test("the adapter's authoritative partial snapshot yields partial usage coverage", () =>
  rootAsync(async () => {
    const scope = nativeScope("root")
    const boundary: NativeBoundary = {
      detail: async ({ sessionID }) => {
        if (sessionID !== "orphan") throw new Error(`missing session: ${sessionID}`)
        return {
          info: {
            id: "orphan",
            parentID: "missing",
            title: "Orphan worker",
            directory: "/root/git/demo",
            cost: 3,
            tokens: { input: 300, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          needsInput: false,
        }
      },
      children: async () => ({ data: [] }),
      active: async () => ({}),
    }
    const owner = createNativeExecutionOwner({
      scope: () => scope,
      selectedSessionID: () => "orphan",
      createAdapter: (target) => createNativeExecutionAdapter({ target: () => target, boundary }),
    })
    const model = createExecutionModel({
      scope: () => scope,
      snapshot: () => runFixture({ runID: "run-native" }),
      agents: () => (owner.snapshot()?.nodes ?? []).map((record) => ({ ...record, state: nativeState(record) })),
      nativeComplete: () => owner.snapshot()?.complete,
    })
    owner.refresh()
    await settle()
    expect(owner.snapshot()?.rootSessionID).toBeUndefined()
    expect(owner.snapshot()?.complete).toBe(false)
    expect(owner.snapshot()?.missingParentID).toBe("missing")
    expect(model.activityUsage().cost).toEqual({ value: 3, coverage: "partial" })
    expect(model.activityUsage().tokens).toEqual({ value: 300, coverage: "partial" })
  }))

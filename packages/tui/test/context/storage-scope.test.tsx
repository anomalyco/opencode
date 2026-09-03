/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createComponent, createRoot } from "solid-js"
import { TuiAppProvider, TuiPathsProvider } from "../../src/context/runtime"
import { StorageProvider, useStorage, type Storage } from "../../src/context/storage"
import { tmpdir } from "../fixture/fixture"

function setup(state: string, channel: string) {
  return createRoot((dispose) => {
    let storage: Storage
    function Consumer() {
      storage = useStorage()
      return null
    }
    createComponent(TuiPathsProvider, {
      value: { cwd: state, home: state, state, worktree: state },
      get children() {
        return (
          <TuiAppProvider value={{ name: "test", version: "0.0.0", channel }}>
            <StorageProvider>
              <Consumer />
            </StorageProvider>
          </TuiAppProvider>
        )
      },
    })
    return { storage: storage!, [Symbol.dispose]: dispose }
  })
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check() && Date.now() < deadline) await Bun.sleep(10)
  expect(check()).toBe(true)
}

test("global stores synchronize live across independent release channels", async () => {
  await using tmp = await tmpdir()
  using first = setup(tmp.path, "dev")
  using second = setup(tmp.path, "beta")
  const options = { initial: { items: [] as string[] }, scope: "global" as const }
  const [a, updateA] = first.storage.store("shared", options)
  const [b, updateB] = second.storage.store("shared", options)

  await updateA((draft) => draft.items.push("first"))
  await waitFor(() => b.items[0] === "first")
  await updateB((draft) => draft.items.splice(0, 1, "second"))
  await waitFor(() => a.items[0] === "second")
  expect(await Bun.file(path.join(tmp.path, "tui", "shared.json")).json()).toEqual({ items: ["second"] })
  expect(existsSync(path.join(tmp.path, "locks"))).toBe(true)
  expect(existsSync(path.join(tmp.path, "dev"))).toBe(false)
  expect(existsSync(path.join(tmp.path, "beta"))).toBe(false)
})

test("default channel stores remain separate from other channels and global stores", async () => {
  await using tmp = await tmpdir()
  using first = setup(tmp.path, "dev")
  using second = setup(tmp.path, "beta")
  const options = { initial: { value: "initial" } }
  const local = first.storage.store("same", options)
  const remote = second.storage.store("same", { ...options, scope: "channel" })
  const global = first.storage.store("same", { ...options, scope: "global" })
  expect(first.storage.store("same", { ...options, scope: "channel" })).toBe(local)

  await local[1]((draft) => (draft.value = "dev"))
  await remote[1]((draft) => (draft.value = "beta"))
  await global[1]((draft) => (draft.value = "global"))
  await Bun.sleep(100)

  expect(local[0].value).toBe("dev")
  expect(remote[0].value).toBe("beta")
  expect(global[0].value).toBe("global")
  expect(await Bun.file(path.join(tmp.path, "dev", "tui", "same.json")).json()).toEqual({ value: "dev" })
  expect(await Bun.file(path.join(tmp.path, "beta", "tui", "same.json")).json()).toEqual({ value: "beta" })
  expect(await Bun.file(path.join(tmp.path, "tui", "same.json")).json()).toEqual({ value: "global" })
  expect(existsSync(path.join(tmp.path, "dev", "locks"))).toBe(true)
  expect(existsSync(path.join(tmp.path, "beta", "locks"))).toBe(true)
})

test("concurrent global mutations preserve both writers", async () => {
  await using tmp = await tmpdir()
  using first = setup(tmp.path, "dev")
  using second = setup(tmp.path, "beta")
  const options = { initial: { items: [] as string[] }, scope: "global" as const }
  const [a, updateA] = first.storage.store("shared", options)
  const [b, updateB] = second.storage.store("shared", options)

  await Promise.all([updateA((draft) => draft.items.push("dev")), updateB((draft) => draft.items.push("beta"))])
  await waitFor(() => a.items.length === 2 && b.items.length === 2)
  expect([...a.items].sort()).toEqual(["beta", "dev"])
  expect([...b.items].sort()).toEqual(["beta", "dev"])
  expect(await Bun.file(path.join(tmp.path, "tui", "shared.json")).json()).toEqual({ items: [...a.items] })
})

test("global write failures reject the mutation and an in-flight flush", async () => {
  await using tmp = await tmpdir()
  using first = setup(tmp.path, "dev")
  const [store, update] = first.storage.store("blocked", { initial: { value: "initial" }, scope: "global" })
  await mkdir(path.join(tmp.path, "tui", "blocked.json"))

  const results = await Promise.allSettled([update((draft) => (draft.value = "changed")), first.storage.flush()])
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
  expect(store.value).toBe("initial")
})

test("memory stores stay provider-local and do not create storage directories", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  using first = setup(state, "dev")
  using second = setup(state, "dev")
  const a = first.storage.memory("same", { initial: { value: "initial" } })
  const b = second.storage.memory("same", { initial: { value: "initial" } })
  expect(first.storage.memory("same", { initial: { value: "other" } })).toBe(a)

  a[1]((draft) => (draft.value = "changed"))
  expect(a[0].value).toBe("changed")
  expect(b[0].value).toBe("initial")
  expect(existsSync(state)).toBe(false)
})

test("provider cleanup stops both global and channel watchers", async () => {
  await using tmp = await tmpdir()
  const first = setup(tmp.path, "dev")
  using second = setup(tmp.path, "dev")
  const options = { initial: { value: "initial" } }
  const local = first.storage.store("same", options)
  const global = first.storage.store("same", { ...options, scope: "global" })
  const remoteLocal = second.storage.store("same", options)
  const remoteGlobal = second.storage.store("same", { ...options, scope: "global" })
  first[Symbol.dispose]()

  await Promise.all([
    remoteLocal[1]((draft) => (draft.value = "changed")),
    remoteGlobal[1]((draft) => (draft.value = "changed")),
  ])
  await Bun.sleep(100)
  expect(local[0].value).toBe("initial")
  expect(global[0].value).toBe("initial")
})

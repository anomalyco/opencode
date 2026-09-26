import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mutateStore } from "./store-write"

const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "opencode-store-write-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function eperm() {
  const error = new Error("EPERM: operation not permitted, rename 'tmp' -> 'target'") as Error & { code: string }
  error.code = "EPERM"
  return error
}

// Mirrors electron-store: set/delete/clear write the whole file, the `store`
// getter reads whatever is currently on disk.
function createFileStore(file: string, log: string[]) {
  const read = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  const write = (data: Record<string, unknown>) => writeFileSync(file, JSON.stringify(data, null, "\t"))
  const state = { failures: 0 }
  const guard = (action: string) => {
    log.push(action)
    if (state.failures > 0) {
      state.failures--
      log.push(`${action}:EPERM`)
      throw eperm()
    }
  }
  return {
    state,
    get store() {
      return read()
    },
    set(key: string, value: unknown) {
      guard("set")
      write({ ...read(), [key]: value })
    },
    delete(key: string) {
      guard("delete")
      const data = read()
      delete data[key]
      write(data)
    },
    clear() {
      guard("clear")
      write({})
    },
  }
}

describe("mutateStore", () => {
  test("retries transient failures until the write lands", async () => {
    const root = await tempRoot()
    const file = join(root, "opencode.workspace.test.dat")
    writeFileSync(file, "{}")
    const log: string[] = []
    const store = createFileStore(file, log)
    store.state.failures = 2

    await mutateStore({ name: "test", file, store }, (target) => target.set("key", "value"))

    expect(log).toEqual(["set", "set:EPERM", "set", "set:EPERM", "set"])
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ key: "value" })
  })

  test("writes the mutation in place when the atomic rename keeps failing", async () => {
    const root = await tempRoot()
    const file = join(root, "opencode.workspace.test.dat")
    writeFileSync(file, JSON.stringify({ keep: "1" }))
    const log: string[] = []
    const store = createFileStore(file, log)
    store.state.failures = Number.MAX_SAFE_INTEGER

    await mutateStore({ name: "test", file, store }, (target) => target.set("added", "2"))
    await mutateStore({ name: "test", file, store }, (target) => target.delete("keep"))
    await mutateStore({ name: "test", file, store }, (target) => target.clear())

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({})
  })

  test("leaves the file untouched when the failure is not transient", async () => {
    const root = await tempRoot()
    const file = join(root, "opencode.workspace.test.dat")
    writeFileSync(file, JSON.stringify({ keep: "1" }))
    const log: string[] = []
    const store = createFileStore(file, log)
    const broken = {
      ...store,
      set() {
        throw new Error("boom")
      },
    }

    await expect(
      mutateStore({ name: "test", file, store: broken }, (target) => target.set("key", "value")),
    ).rejects.toThrow("boom")
    expect(log).toEqual([])
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ keep: "1" })
  })

  test("serializes concurrent mutations of the same store", async () => {
    const root = await tempRoot()
    const file = join(root, "opencode.workspace.test.dat")
    writeFileSync(file, "{}")
    const log: string[] = []
    const store = createFileStore(file, log)
    store.state.failures = 1

    const first = mutateStore({ name: "test", file, store }, (target) => target.set("first", "1"))
    const second = mutateStore({ name: "test", file, store }, (target) => target.set("second", "2"))
    await Promise.all([first, second])

    expect(log).toEqual(["set", "set:EPERM", "set", "set"])
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ first: "1", second: "2" })
  })

  test("does not block mutations of a different store", async () => {
    const root = await tempRoot()
    const file = join(root, "opencode.workspace.test.dat")
    writeFileSync(file, "{}")
    const log: string[] = []
    const store = createFileStore(file, log)
    store.state.failures = 1

    const slow = mutateStore({ name: "test", file, store }, (target) => target.set("slow", "1"))
    const otherFile = join(root, "opencode.workspace.other.dat")
    writeFileSync(otherFile, "{}")
    const otherLog: string[] = []
    const other = mutateStore(
      { name: "other", file: otherFile, store: createFileStore(otherFile, otherLog) },
      (target) => target.set("key", "value"),
    )
    await Promise.all([slow, other])

    expect(otherLog).toEqual(["set"])
    expect(JSON.parse(readFileSync(otherFile, "utf8"))).toEqual({ key: "value" })
  })
})

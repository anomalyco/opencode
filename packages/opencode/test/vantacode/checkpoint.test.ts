import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CheckpointStore } from "@/vantacode/checkpoint"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vantacode-cp-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const file = (name: string) => path.join(dir, name)

describe("CheckpointStore snapshot + rewind", () => {
  test("restores a modified file to its pre-edit contents", () => {
    const f = file("a.txt")
    fs.writeFileSync(f, "original")
    const store = new CheckpointStore()

    store.snapshot(f)
    fs.writeFileSync(f, "modified")
    const cp = store.commit("edit a")
    expect(cp).toBeDefined()

    const undo = store.rewindLast()
    expect(undo?.restored).toContain(path.resolve(f))
    expect(fs.readFileSync(f, "utf8")).toBe("original")
  })

  test("deletes a file that did not exist before the edit", () => {
    const f = file("new.txt")
    const store = new CheckpointStore()

    store.snapshot(f) // file does not exist yet → before = null
    fs.writeFileSync(f, "created")
    store.commit("create new")

    store.rewindLast()
    expect(fs.existsSync(f)).toBe(false)
  })

  test("does not double-snapshot the same file within one turn", () => {
    const f = file("b.txt")
    fs.writeFileSync(f, "v0")
    const store = new CheckpointStore()

    store.snapshot(f)
    fs.writeFileSync(f, "v1")
    store.snapshot(f) // should be ignored — keeps the v0 snapshot
    fs.writeFileSync(f, "v2")
    store.commit("two edits")

    store.rewindLast()
    expect(fs.readFileSync(f, "utf8")).toBe("v0")
  })

  test("commit with no pending snapshots returns undefined", () => {
    const store = new CheckpointStore()
    expect(store.commit("empty")).toBeUndefined()
  })

  test("rewindLast on an empty store returns undefined", () => {
    const store = new CheckpointStore()
    expect(store.rewindLast()).toBeUndefined()
  })

  test("rewindTo undoes multiple checkpoints newest-first", () => {
    const f = file("c.txt")
    fs.writeFileSync(f, "s0")
    const store = new CheckpointStore()

    store.snapshot(f)
    fs.writeFileSync(f, "s1")
    const cp1 = store.commit("turn 1")!

    store.snapshot(f)
    fs.writeFileSync(f, "s2")
    store.commit("turn 2")

    const result = store.rewindTo(cp1.id)
    expect(result.count).toBe(2)
    expect(fs.readFileSync(f, "utf8")).toBe("s0")
  })

  test("persist + load round-trips checkpoints", () => {
    const f = file("d.txt")
    fs.writeFileSync(f, "before")
    const store = new CheckpointStore()
    store.snapshot(f)
    fs.writeFileSync(f, "after")
    store.commit("turn")

    const saveFile = file("checkpoints.json")
    store.persist(saveFile)
    expect(fs.existsSync(saveFile)).toBe(true)

    const loaded = CheckpointStore.load(saveFile)
    expect(loaded.list()).toHaveLength(1)
    // restoring from the loaded store still reverts the file
    loaded.rewindLast()
    expect(fs.readFileSync(f, "utf8")).toBe("before")
  })
})

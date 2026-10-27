import { expect, mock, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit } from "effect"

// By default, what Bun does when the snapshot is too large to serialize: it leaves the file empty and returns.
let writeHeapSnapshot = (file: string) => file
mock.module("node:v8", () => ({ writeHeapSnapshot: (file: string) => writeHeapSnapshot(file) }))
const { HeapSnapshot } = await import("./heap-snapshot.js")

const inTempDirectory = async (body: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heap-snapshot-"))
  try {
    await body(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("fails and removes the file when the runtime writes an empty snapshot, then frees the lock", () =>
  inTempDirectory(async (directory) => {
    for (const _ of [1, 2]) {
      const exit = await Effect.runPromiseExit(HeapSnapshot.write(directory))
      expect(Exit.isFailure(exit) && String(exit.cause)).toContain("HeapSnapshot.EmptySnapshotError")
      expect(await readdir(directory)).toEqual([])
    }
  }))

test("removes the file when the runtime throws", () =>
  inTempDirectory(async (directory) => {
    writeHeapSnapshot = () => {
      throw new Error("out of memory")
    }
    const exit = await Effect.runPromiseExit(HeapSnapshot.write(directory))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(await readdir(directory)).toEqual([])
  }))

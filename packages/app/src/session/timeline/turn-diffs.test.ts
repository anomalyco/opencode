import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createTurnDiffCache } from "./turn-diffs"

const turn = { sessionID: "ses_a", from: "msg_open" }

// Every pending promise callback runs before the next macrotask.
const settle = () => new Promise((resolve) => setImmediate(resolve))

const diff = { file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" } satisfies FileDiffInfo

describe("turn diff cache", () => {
  test("loads each turn once and retries after a failure", async () => {
    const cache = createRoot(() => createTurnDiffCache())
    const failed = Promise.withResolvers<readonly FileDiffInfo[]>()
    const calls: string[] = []

    cache.load(turn, () => (calls.push("failed"), failed.promise))
    cache.load(turn, () => (calls.push("duplicate"), Promise.resolve([diff])))
    failed.reject(new Error("offline"))
    await settle()
    expect(cache.get(turn)).toBeUndefined()

    cache.load(turn, () => (calls.push("retry"), Promise.resolve([diff])))
    await settle()
    cache.load(turn, () => (calls.push("cached"), Promise.resolve([])))

    expect(calls).toEqual(["failed", "retry"])
    expect(cache.get(turn)).toEqual([diff])
  })
})

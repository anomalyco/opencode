import { describe, expect, test } from "bun:test"
import { Worktree } from "./worktree"

const dir = (name: string) => `/tmp/opencode-worktree-${name}-${crypto.randomUUID()}`

describe("Worktree", () => {
  test("normalizes trailing slashes", () => {
    const key = dir("normalize")
    Worktree.ready(`${key}/`)

    expect(Worktree.get(key)).toEqual({ status: "ready" })
  })

  test("pending does not overwrite a terminal state", () => {
    const key = dir("pending")
    Worktree.failed(key, "boom")
    Worktree.pending(key)

    expect(Worktree.get(key)).toEqual({ status: "failed", message: "boom" })
  })

  test("wait resolves shared pending waiter when ready", async () => {
    const key = dir("wait-ready")
    Worktree.pending(key)

    const a = Worktree.wait(key)
    const b = Worktree.wait(`${key}/`)

    expect(a).toBe(b)

    Worktree.ready(key)

    expect(await a).toEqual({ status: "ready" })
    expect(await b).toEqual({ status: "ready" })
  })

  test("wait resolves with failure message", async () => {
    const key = dir("wait-failed")
    const waiting = Worktree.wait(key)

    Worktree.failed(key, "permission denied")

    expect(await waiting).toEqual({ status: "failed", message: "permission denied" })
    expect(await Worktree.wait(key)).toEqual({ status: "failed", message: "permission denied" })
  })
})

import { describe, expect, test } from "bun:test"
import {
  ExploreForkError,
  runExploreFork,
  type ExploreForkClient,
  type ExploreForkTarget,
} from "./dialog-fork-flow"

type ForkInput = { sessionID: string; messageID?: string }

type Calls = {
  clients: string[]
  creates: Array<{ directory: string; input: { directory: string } }>
  pending: string[]
  waits: string[]
  syncs: string[]
  diffs: string[]
  applies: Array<{ directory: string; patch: string }>
  forks: Array<{ directory: string; input: ForkInput }>
}

function createHarness(input?: { patch?: string; createdDirectory?: string; applyFailsIn?: string }) {
  const calls: Calls = {
    clients: [],
    creates: [],
    pending: [],
    waits: [],
    syncs: [],
    diffs: [],
    applies: [],
    forks: [],
  }
  const sourceDirectory = "/repo/main"
  const patch = input?.patch ?? "diff --git a/file.txt b/file.txt"
  const createdDirectory = input?.createdDirectory ?? "/repo/main-explore"

  const clientFor = (directory: string): ExploreForkClient => ({
    session: {
      fork: async (value) => {
        calls.forks.push({ directory, input: value })
        return { data: { id: `forked:${directory}` } }
      },
    },
    worktree: {
      create: async (value) => {
        calls.creates.push({ directory, input: value })
        return { data: { directory: createdDirectory } }
      },
    },
    vcs: {
      diff2: {
        raw: async () => {
          calls.diffs.push(directory)
          return { data: patch }
        },
      },
      apply: async (value) => {
        calls.applies.push({ directory, patch: value.patch })
        if (directory === input?.applyFailsIn) throw new Error("apply failed")
        return { data: { applied: true } }
      },
    },
  })

  const run = (target: ExploreForkTarget) =>
    runExploreFork({
      client: clientFor(sourceDirectory),
      sourceDirectory,
      sessionID: "ses_1",
      target,
      createClient: (directory) => {
        calls.clients.push(directory)
        return clientFor(directory)
      },
      markWorktreePending: (directory) => {
        calls.pending.push(directory)
      },
      waitForWorktree: async (directory) => {
        calls.waits.push(directory)
        return { status: "ready" }
      },
      syncChild: (directory) => {
        calls.syncs.push(directory)
      },
    })

  return {
    calls,
    createdDirectory,
    run,
    sourceDirectory,
  }
}

describe("runExploreFork", () => {
  test("creates a worktree, copies the diff, forks with the target client", async () => {
    const harness = createHarness()
    const result = await harness.run({ type: "create" })

    expect(result).toEqual({ directory: harness.createdDirectory, sessionID: `forked:${harness.createdDirectory}` })
    expect(harness.calls.creates).toEqual([
      { directory: harness.sourceDirectory, input: { directory: harness.sourceDirectory } },
    ])
    expect(harness.calls.pending).toEqual([harness.createdDirectory])
    expect(harness.calls.waits).toEqual([harness.createdDirectory])
    expect(harness.calls.clients).toEqual([harness.createdDirectory])
    expect(harness.calls.syncs).toEqual([harness.createdDirectory])
    expect(harness.calls.diffs).toEqual([harness.sourceDirectory])
    expect(harness.calls.applies).toEqual([
      { directory: harness.createdDirectory, patch: "diff --git a/file.txt b/file.txt" },
    ])
    expect(harness.calls.forks).toEqual([
      { directory: harness.createdDirectory, input: { sessionID: "ses_1" } },
    ])
  })

  test("uses an existing worktree without creating a new one", async () => {
    const harness = createHarness()
    const target = "/repo/existing"
    const result = await harness.run({ type: "existing", directory: target })

    expect(result).toEqual({ directory: target, sessionID: `forked:${target}` })
    expect(harness.calls.creates).toEqual([])
    expect(harness.calls.pending).toEqual([])
    expect(harness.calls.waits).toEqual([])
    expect(harness.calls.clients).toEqual([target])
    expect(harness.calls.syncs).toEqual([target])
    expect(harness.calls.applies).toEqual([{ directory: target, patch: "diff --git a/file.txt b/file.txt" }])
    expect(harness.calls.forks).toEqual([{ directory: target, input: { sessionID: "ses_1" } }])
  })

  test("forks in the current worktree without copying changes", async () => {
    const harness = createHarness()
    const result = await harness.run({ type: "current", directory: harness.sourceDirectory })

    expect(result).toEqual({ directory: harness.sourceDirectory, sessionID: `forked:${harness.sourceDirectory}` })
    expect(harness.calls.clients).toEqual([])
    expect(harness.calls.syncs).toEqual([])
    expect(harness.calls.diffs).toEqual([])
    expect(harness.calls.applies).toEqual([])
    expect(harness.calls.forks).toEqual([{ directory: harness.sourceDirectory, input: { sessionID: "ses_1" } }])
  })

  test("stops before forking when applying the diff fails", async () => {
    const target = "/repo/existing"
    const harness = createHarness({ applyFailsIn: target })
    const error = await harness.run({ type: "existing", directory: target }).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(ExploreForkError)
    if (error instanceof ExploreForkError) expect(error.kind).toBe("copy")
    expect(harness.calls.applies).toEqual([{ directory: target, patch: "diff --git a/file.txt b/file.txt" }])
    expect(harness.calls.forks).toEqual([])
  })
})

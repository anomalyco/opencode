import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff, UserMessage } from "@opencode-ai/sdk/v2"
import { Timeline } from "./rows"

const userMessage = (diffs: SnapshotFileDiff[]) =>
  ({
    id: "msg_user",
    sessionID: "ses_test",
    role: "user",
    time: { created: 1 },
    summary: { diffs },
    agent: "build",
    model: {
      providerID: "provider",
      modelID: "model",
    },
  }) satisfies UserMessage

const diff = (file: string, patch: string) =>
  ({
    file,
    patch,
    additions: 1,
    deletions: 0,
    status: "modified",
  }) satisfies SnapshotFileDiff

class CountedDiff implements SnapshotFileDiff {
  readonly patch = ""
  readonly additions = 1
  readonly deletions = 0
  readonly status = "modified"
  private reads = 0

  constructor(private readonly name: string) {}

  get file() {
    this.reads += 1
    return this.name
  }

  get fileReads() {
    return this.reads
  }
}

const diffSummary = (message: UserMessage) =>
  Timeline.constructMessageRows(message, () => [], [], 0, true, "idle", false).find((row) => row._tag === "DiffSummary")

describe("timeline rows", () => {
  test("keeps the last visible diff for each file in original order", () => {
    const row = diffSummary(
      userMessage([
        diff("alpha.ts", "old alpha"),
        diff("beta.ts", "beta"),
        { patch: "missing file", additions: 1, deletions: 0 },
        diff("alpha.ts", "new alpha"),
      ]),
    )

    expect(row?._tag).toBe("DiffSummary")
    expect(row?.diffs).toEqual([diff("beta.ts", "beta"), diff("alpha.ts", "new alpha")])
  })

  test("builds large unique diff summaries without dropping visible files", () => {
    const diffs = Array.from({ length: 12_000 }, (_item, index) => new CountedDiff(`file-${index}.ts`))
    const row = diffSummary(userMessage(diffs))

    expect(row?._tag).toBe("DiffSummary")
    expect(row?.diffs).toHaveLength(12_000)
    expect(row?.diffs.at(0)?.file).toBe("file-0.ts")
    expect(row?.diffs.at(-1)?.file).toBe("file-11999.ts")
    expect(diffs.reduce((total, item) => total + item.fileReads, 0)).toBeLessThanOrEqual(diffs.length + 2)
  })
})

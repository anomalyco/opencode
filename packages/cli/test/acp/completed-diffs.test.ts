import { describe, expect, test } from "bun:test"
import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { tmpdir } from "../fixture/tmpdir"
import { ACPPermission } from "../../src/acp/permission"

describe("acp completed diffs", () => {
  test("leaves a script's changes alone: some have no diff, and a file can change more than once", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/a.txt`, "a\nb\nc\n")
    const update = { sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed" } as SessionUpdate
    const result = await Effect.runPromise(
      ACPPermission.withCompletedDiffs(
        update,
        {
          toolName: "execute",
          input: { code: "1" },
          metadata: {
            files: [
              { file: "a.txt", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1,2 @@\n a\n+b\n" },
              { file: "a.txt", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,2 +1,3 @@\n a\n b\n+c\n" },
            ],
          },
        },
        tmp.path,
      ),
    )
    expect(result).toBe(update)
  })
})

import { describe, expect, test } from "bun:test"
import { inflate } from "./session-diff"

describe("session diff", () => {
  test("inflates unified patch content", () => {
    const diff = {
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }

    expect(inflate(diff)).toEqual({
      ...diff,
      before: "one\ntwo\n",
      after: "one\nthree\n",
    })
  })

  test("preserves legacy before and after content", () => {
    const diff = {
      file: "a.ts",
      before: "one\n",
      after: "two\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }

    expect(inflate(diff)).toEqual({
      ...diff,
      before: "one\n",
      after: "two\n",
    })
  })
})

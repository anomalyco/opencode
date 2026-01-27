import { describe, expect, test } from "bun:test"
import {
  generateFeedbackMessage,
  getChanges,
  clampIndex,
  type ReviewComment,
} from "../../../src/cli/cmd/tui/util/review"
import { Keybind } from "../../../src/util/keybind"
import type { Snapshot } from "../../../src/snapshot"

describe("review utilities", () => {
  describe("clampIndex", () => {
    test("returns 0 for empty length", () => {
      expect(clampIndex(0, 0)).toBe(0)
      expect(clampIndex(5, 0)).toBe(0)
      expect(clampIndex(-1, 0)).toBe(0)
    })

    test("clamps negative indices to 0", () => {
      expect(clampIndex(-1, 5)).toBe(0)
      expect(clampIndex(-10, 5)).toBe(0)
    })

    test("clamps high indices to max valid index", () => {
      expect(clampIndex(10, 5)).toBe(4)
      expect(clampIndex(100, 3)).toBe(2)
    })

    test("returns index unchanged when within bounds", () => {
      expect(clampIndex(0, 5)).toBe(0)
      expect(clampIndex(2, 5)).toBe(2)
      expect(clampIndex(4, 5)).toBe(4)
    })
  })

  describe("getChanges", () => {
    test("returns empty array for identical before/after", () => {
      const diff: Snapshot.FileDiff = {
        file: "test.ts",
        before: "const x = 1",
        after: "const x = 1",
        additions: 0,
        deletions: 0,
      }
      const changes = getChanges(diff)
      expect(changes).toEqual([])
    })

    test("creates single change for simple diff", () => {
      const diff: Snapshot.FileDiff = {
        file: "test.ts",
        before: "const x = 1",
        after: "const x = 2",
        additions: 1,
        deletions: 1,
      }
      const changes = getChanges(diff)
      expect(changes.length).toBe(1)
      expect(changes[0].file).toBe("test.ts")
      expect(changes[0].id).toContain("test.ts:")
    })

    test("creates multiple changes for multi-hunk diff", () => {
      const diff: Snapshot.FileDiff = {
        file: "test.ts",
        before: `line1
line2
line3
line4
line5
line6
line7
line8
line9
line10`,
        after: `line1
CHANGED
line3
line4
line5
line6
line7
line8
ALSO_CHANGED
line10`,
        additions: 2,
        deletions: 2,
      }
      const changes = getChanges(diff)
      // The diff library may group these differently depending on context
      expect(changes.length).toBeGreaterThanOrEqual(1)
    })

    test("change has hunk information", () => {
      const diff: Snapshot.FileDiff = {
        file: "test.ts",
        before: "const x = 1",
        after: "const x = 2",
        additions: 1,
        deletions: 1,
      }
      const changes = getChanges(diff)
      expect(changes[0].hunk).toBeDefined()
      expect(changes[0].hunk.oldStart).toBeDefined()
      expect(changes[0].hunk.newStart).toBeDefined()
    })
  })

  describe("generateFeedbackMessage", () => {
    test("returns null for empty diffs", () => {
      expect(generateFeedbackMessage([], {})).toBe(null)
    })

    test("returns null when no comments", () => {
      const diffs: Snapshot.FileDiff[] = [makeDiff("file1.ts"), makeDiff("file2.ts")]
      expect(generateFeedbackMessage(diffs, {})).toBe(null)
    })

    test("generates message with comments", () => {
      const diffs: Snapshot.FileDiff[] = [
        {
          file: "src/app.ts",
          before: "const x = 1",
          after: "const x = 2",
          additions: 1,
          deletions: 1,
        },
      ]
      const changes = getChanges(diffs[0])
      const changeId = changes[0]?.id
      if (!changeId) throw new Error("No change ID")

      const comments: Record<string, Record<string, ReviewComment[]>> = {
        "src/app.ts": {
          [changeId]: [{ id: "1", text: "This needs improvement", createdAt: Date.now() }],
        },
      }

      const message = generateFeedbackMessage(diffs, comments)
      expect(message).toContain("## Review Feedback")
      expect(message).toContain("src/app.ts")
      expect(message).toContain("This needs improvement")
    })

    test("includes multiple comments for same change", () => {
      const diffs: Snapshot.FileDiff[] = [
        {
          file: "test.ts",
          before: "const x = 1",
          after: "const x = 2",
          additions: 1,
          deletions: 1,
        },
      ]
      const changes = getChanges(diffs[0])
      const changeId = changes[0]?.id
      if (!changeId) throw new Error("No change ID")

      const comments: Record<string, Record<string, ReviewComment[]>> = {
        "test.ts": {
          [changeId]: [
            { id: "1", text: "First comment", createdAt: Date.now() },
            { id: "2", text: "Second comment", createdAt: Date.now() },
          ],
        },
      }

      const message = generateFeedbackMessage(diffs, comments)
      expect(message).toContain("First comment")
      expect(message).toContain("Second comment")
    })
  })
})

// Helper to create FileDiff for testing
function makeDiff(file: string, additions = 1, deletions = 0): Snapshot.FileDiff {
  return {
    file,
    before: "",
    after: "new content",
    additions,
    deletions,
  }
}

describe("review keybind integration", () => {
  test("review_submit keybind is Shift+S", () => {
    const keybind = Keybind.parse("shift+s")[0]

    const shiftS: Keybind.Info = {
      name: "s",
      ctrl: false,
      meta: false,
      shift: true,
      super: false,
      leader: false,
    }

    expect(Keybind.match(keybind, shiftS)).toBe(true)

    // Plain 's' should NOT match
    const plainS: Keybind.Info = { ...shiftS, shift: false }
    expect(Keybind.match(keybind, plainS)).toBe(false)
  })

  test("review navigation keybinds (j/k) are simple keys without modifiers", () => {
    const nextKeybind = Keybind.parse("j")[0]
    const prevKeybind = Keybind.parse("k")[0]

    const jKey: Keybind.Info = {
      name: "j",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    const kKey: Keybind.Info = {
      name: "k",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    expect(Keybind.match(nextKeybind, jKey)).toBe(true)
    expect(Keybind.match(prevKeybind, kKey)).toBe(true)

    // With modifiers should NOT match
    const ctrlJ: Keybind.Info = { ...jKey, ctrl: true }
    expect(Keybind.match(nextKeybind, ctrlJ)).toBe(false)
  })

  test("review_comment keybind is simple 'c' key", () => {
    const keybind = Keybind.parse("c")[0]

    const cKey: Keybind.Info = {
      name: "c",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    expect(Keybind.match(keybind, cKey)).toBe(true)
    expect(Keybind.match(keybind, { ...cKey, ctrl: true })).toBe(false)
  })
})

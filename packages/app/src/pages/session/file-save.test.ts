import { describe, expect, mock, test } from "bun:test"
import {
  activeEditor,
  clearActiveEditor,
  createFileSaver,
  guardTab,
  isDirtyAgainst,
  registerActiveEditor,
  setPendingEditOpen,
  takePendingEditOpen,
  type WriteResult,
} from "./file-save"

type Harness = {
  editing: boolean
  text: string
  dirty: boolean
  conflict?: "reload" | "overwrite" | undefined
  unsaved?: "save" | "discard" | "cancel" | undefined
}

function createHarness(initial: Partial<Harness> & { write: (content: string, expectedSha?: string) => WriteResult }) {
  const state: Harness = {
    editing: true,
    text: "",
    dirty: false,
    ...initial,
  }
  const writes: Array<{ content: string; expectedSha?: string }> = []
  const saver = createFileSaver({
    editing: () => state.editing,
    currentText: () => state.text,
    isDirty: () => state.dirty,
    setDirty: (v) => {
      state.dirty = v
    },
    write: async (content, expectedSha) => {
      writes.push({ content, expectedSha })
      return initial.write(content, expectedSha)
    },
    reloadFromDisk: () => {},
    leaveEditMode: () => {
      state.editing = false
    },
    promptConflict: async () => state.conflict,
    promptUnsaved: async () => state.unsaved,
  })
  return { state, saver, writes }
}

describe("isDirtyAgainst", () => {
  test("dirty when content differs, clean when it matches (empty is valid)", () => {
    expect(isDirtyAgainst("a", "b")).toBe(true)
    expect(isDirtyAgainst("a", "a")).toBe(false)
    expect(isDirtyAgainst("", "")).toBe(false)
    expect(isDirtyAgainst("x", "")).toBe(true)
  })
})

describe("createFileSaver.onChange dirty tracking", () => {
  test("editing sets dirty; returning to baseline clears it", () => {
    const { state, saver } = createHarness({ write: () => ({ written: true }) })
    saver.setBaseline("hello", "sha1")

    saver.onChange("hello world")
    expect(state.dirty).toBe(true)

    saver.onChange("hello")
    expect(state.dirty).toBe(false)
  })
})

describe("createFileSaver.save", () => {
  test("writes content with expectedSha, clears dirty, updates baseline", async () => {
    const { state, saver, writes } = createHarness({
      text: "new",
      dirty: true,
      write: () => ({ written: true, sha: "sha2" }),
    })
    saver.setBaseline("old", "sha1")

    await saver.save()

    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual({ content: "new", expectedSha: "sha1" })
    expect(state.dirty).toBe(false)
    expect(saver.baselineSha).toBe("sha2")

    // Baseline updated: editing back to "new" is clean, "old" is now dirty.
    saver.onChange("new")
    expect(state.dirty).toBe(false)
  })

  test("idempotent: no write when not dirty", async () => {
    const { saver, writes } = createHarness({ text: "x", dirty: false, write: () => ({ written: true }) })
    await saver.save()
    expect(writes).toHaveLength(0)
  })

  test("conflict triggers prompt and keeps dirty when dismissed", async () => {
    const prompt = mock(async () => undefined as "reload" | "overwrite" | undefined)
    const state = { editing: true, text: "new", dirty: true }
    const writes: Array<{ content: string; expectedSha?: string }> = []
    const saver = createFileSaver({
      editing: () => state.editing,
      currentText: () => state.text,
      isDirty: () => state.dirty,
      setDirty: (v) => {
        state.dirty = v
      },
      write: async (content, expectedSha) => {
        writes.push({ content, expectedSha })
        return { written: false, conflict: true }
      },
      reloadFromDisk: () => {},
      leaveEditMode: () => {},
      promptConflict: () => prompt(),
      promptUnsaved: async () => undefined,
    })
    saver.setBaseline("old", "sha1")

    await saver.save()

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(state.dirty).toBe(true) // still dirty after dismiss
  })

  test("conflict + overwrite re-sends WITHOUT expectedSha and clears dirty", async () => {
    const writes: Array<{ content: string; expectedSha?: string }> = []
    const state = { editing: true, text: "new", dirty: true }
    let call = 0
    const saver = createFileSaver({
      editing: () => state.editing,
      currentText: () => state.text,
      isDirty: () => state.dirty,
      setDirty: (v) => {
        state.dirty = v
      },
      write: async (content, expectedSha) => {
        writes.push({ content, expectedSha })
        call += 1
        return call === 1 ? { written: false, conflict: true } : { written: true, sha: "sha3" }
      },
      reloadFromDisk: () => {},
      leaveEditMode: () => {},
      promptConflict: async () => "overwrite",
      promptUnsaved: async () => undefined,
    })
    saver.setBaseline("old", "sha1")

    await saver.save()

    expect(writes).toHaveLength(2)
    expect(writes[0].expectedSha).toBe("sha1")
    expect(writes[1].expectedSha).toBeUndefined() // forced overwrite
    expect(state.dirty).toBe(false)
    expect(saver.baselineSha).toBe("sha3")
  })
})

describe("createFileSaver.guard (unsaved guard)", () => {
  test("clean tab is safe without prompting", async () => {
    const prompt = mock(async () => "cancel" as const)
    const { saver } = createHarness({ dirty: false, write: () => ({ written: true }) })
    expect(await saver.guard()).toBe(true)
    expect(prompt).not.toHaveBeenCalled()
  })

  test("dirty tab prompts; cancel blocks", async () => {
    const { saver } = createHarness({ dirty: true, unsaved: "cancel", write: () => ({ written: true }) })
    expect(await saver.guard()).toBe(false)
  })

  test("dirty tab prompts; discard proceeds and clears dirty", async () => {
    const { state, saver } = createHarness({ dirty: true, unsaved: "discard", write: () => ({ written: true }) })
    expect(await saver.guard()).toBe(true)
    expect(state.dirty).toBe(false)
  })

  test("dirty tab prompts; save writes then proceeds", async () => {
    const { state, saver, writes } = createHarness({
      text: "new",
      dirty: true,
      unsaved: "save",
      write: () => ({ written: true, sha: "s" }),
    })
    saver.setBaseline("old")
    expect(await saver.guard()).toBe(true)
    expect(writes).toHaveLength(1)
    expect(state.dirty).toBe(false)
  })
})

describe("active editor registry + guardTab", () => {
  test("guardTab consults the registered editor and isolates by tab", async () => {
    const guard = mock(async () => false)
    registerActiveEditor({
      tab: "file://a",
      editing: () => true,
      dirty: () => true,
      save: () => {},
      guard,
    })

    // Different tab: no active editor for it -> safe, no prompt.
    expect(await guardTab("file://b")).toBe(true)
    expect(guard).not.toHaveBeenCalled()

    // Matching tab: delegates to the editor's guard.
    expect(await guardTab("file://a")).toBe(false)
    expect(guard).toHaveBeenCalledTimes(1)

    clearActiveEditor("file://a")
    expect(activeEditor()).toBeUndefined()
    expect(await guardTab("file://a")).toBe(true)
  })
})

describe("pending cross-file edit-open slot", () => {
  test("takePendingEditOpen returns + clears only for the matching path", () => {
    setPendingEditOpen("go/main.go", { line: 10, character: 4 })

    // Non-matching path leaves the slot intact.
    expect(takePendingEditOpen("go/other.go")).toBeUndefined()

    // Matching path returns the pos and clears it.
    expect(takePendingEditOpen("go/main.go")).toEqual({ line: 10, character: 4 })

    // Slot is now empty.
    expect(takePendingEditOpen("go/main.go")).toBeUndefined()
  })

  test("a later setPendingEditOpen overwrites the previous slot", () => {
    setPendingEditOpen("a.ts", { line: 1, character: 0 })
    setPendingEditOpen("b.ts", { line: 2, character: 3 })
    expect(takePendingEditOpen("a.ts")).toBeUndefined()
    expect(takePendingEditOpen("b.ts")).toEqual({ line: 2, character: 3 })
  })
})

describe("switch-away guard (B1)", () => {
  // Mirrors openTabGuarded in session-side-panel: before switching the active
  // file tab, run guardTab(current); only switch when it resolves true.
  const switchGuarded = async (current: string | undefined, next: string, onSwitch: (tab: string) => void) => {
    if (!current || current === next) {
      onSwitch(next)
      return
    }
    if (await guardTab(current)) onSwitch(next)
  }

  test("switching away from a dirty tab triggers the guard; Cancel aborts, Discard proceeds", async () => {
    // Dirty active tab whose guard cancels.
    const guard = mock(async () => false)
    registerActiveEditor({
      tab: "file://a",
      editing: () => true,
      dirty: () => true,
      save: () => {},
      guard,
    })

    let switched: string | undefined
    await switchGuarded("file://a", "file://b", (t) => (switched = t))
    expect(guard).toHaveBeenCalledTimes(1) // guard consulted
    expect(switched).toBeUndefined() // Cancel aborts the switch

    // Now the guard resolves (Discard/Save) -> switch proceeds.
    const guardOk = mock(async () => true)
    registerActiveEditor({
      tab: "file://a",
      editing: () => true,
      dirty: () => true,
      save: () => {},
      guard: guardOk,
    })
    await switchGuarded("file://a", "file://b", (t) => (switched = t))
    expect(guardOk).toHaveBeenCalledTimes(1)
    expect(switched).toBe("file://b")

    clearActiveEditor("file://a")
  })

  test("switching with no dirty editor does not prompt and proceeds", async () => {
    const guard = mock(async () => false)
    registerActiveEditor({
      tab: "file://a",
      editing: () => false,
      dirty: () => false,
      // guard returns true for a clean tab; this mock should not block.
      guard: async () => true,
      save: () => {},
    })

    let switched: string | undefined
    await switchGuarded("file://a", "file://b", (t) => (switched = t))
    expect(guard).not.toHaveBeenCalled()
    expect(switched).toBe("file://b")
    clearActiveEditor("file://a")
  })
})

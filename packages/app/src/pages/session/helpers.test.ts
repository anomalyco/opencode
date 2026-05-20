import { describe, expect, test, vi } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { createMemo, createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createOpenReviewFile,
  createVcsRefreshManager,
  createVcsRefreshScheduler,
  createOpenSessionFileTab,
  createSessionTabs,
  focusTerminalById,
  getTabReorderIndex,
  isGitHeadPath,
  isGitMetadataPath,
  shouldFocusTerminalOnKeyDown,
} from "./helpers"

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      setActive: (tab) => calls.push(`active:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "load:src/a.ts", "tab:src/a.ts", "open:file://src/a.ts", "active:file://src/a.ts"])
  })
})

describe("createOpenSessionFileTab", () => {
  test("activates the opened file tab", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => {
        calls.push(`normalize:${value}`)
        return `file://${value}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => {
        calls.push(`path:${tab}`)
        return tab.slice("file://".length)
      },
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })

    openTab("src/a.ts")

    expect(calls).toEqual([
      "normalize:src/a.ts",
      "open:file://src/a.ts",
      "path:file://src/a.ts",
      "load:src/a.ts",
      "review",
      "active:file://src/a.ts",
    ])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("shouldFocusTerminalOnKeyDown", () => {
  test("skips pure modifier keys", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Alt", altKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }))).toBe(false)
  })

  test("skips shortcut key combos", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }))).toBe(false)
  })

  test("keeps plain typing focused on terminal", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "a" }))).toBe(true)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "A", shiftKey: true }))).toBe(true)
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("createVcsRefreshScheduler", () => {
  test("batches scheduled calls without extending the first refresh window", async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const scheduler = createVcsRefreshScheduler(() => calls++, 100)

      scheduler.schedule()
      vi.advanceTimersByTime(50)
      scheduler.schedule()
      scheduler.schedule()
      vi.advanceTimersByTime(99)
      await Promise.resolve()
      expect(calls).toBe(1)

      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(calls).toBe(1)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("runs one trailing refresh when changes arrive while refresh is in flight", async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      let resolveRefresh: (() => void) | undefined
      const scheduler = createVcsRefreshScheduler(() => {
        calls++
        return new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
      }, 100)

      scheduler.schedule()
      vi.advanceTimersByTime(100)
      expect(calls).toBe(1)

      scheduler.schedule()
      scheduler.schedule()
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(calls).toBe(1)

      resolveRefresh?.()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(calls).toBe(1)

      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(calls).toBe(2)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("recovers when the refresh throws synchronously", async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const scheduler = createVcsRefreshScheduler(() => {
        calls++
        if (calls === 1) throw new Error("refresh failed")
      }, 100)

      scheduler.schedule()
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      await Promise.resolve()

      scheduler.schedule()
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(calls).toBe(2)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("does not run a trailing refresh after dispose during an active refresh", async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      let resolveRefresh: (() => void) | undefined
      const scheduler = createVcsRefreshScheduler(() => {
        calls++
        return new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
      }, 100)

      scheduler.schedule()
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(calls).toBe(1)

      scheduler.schedule()
      scheduler.dispose()
      resolveRefresh?.()
      await Promise.resolve()
      await Promise.resolve()
      vi.advanceTimersByTime(100)

      expect(calls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test("cancels pending calls on dispose", () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const scheduler = createVcsRefreshScheduler(() => calls++, 100)

      scheduler.schedule()
      scheduler.dispose()
      vi.advanceTimersByTime(100)

      expect(calls).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("drops queued refreshes from a disposed directory scheduler", async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const first = createVcsRefreshScheduler(() => calls.push("first"), 100)

      first.schedule()
      first.dispose()
      const second = createVcsRefreshScheduler(() => calls.push("second"), 100)
      second.schedule()

      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(calls).toEqual(["second"])
      second.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("createVcsRefreshManager", () => {
  test("cleans superseded pending refreshes when the key changes", async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const cleanup: string[] = []
      let setKey: (key: string) => void = () => undefined
      let manager: { schedule(): void; sync(): void } | undefined
      const dispose = createRoot((dispose) => {
        const [key, set] = createSignal("first")
        setKey = (value) => set(value)
        manager = createVcsRefreshManager({
          key,
          refresh: (value) => calls.push(value),
          cleanup: (value) => cleanup.push(value),
          wait: 100,
        })
        return dispose
      })

      manager?.schedule()
      setKey("second")
      await Promise.resolve()
      manager?.schedule()
      vi.advanceTimersByTime(100)
      await Promise.resolve()

      expect(calls).toEqual(["second"])
      expect(cleanup).toEqual(["first"])
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("disposes every scheduler created across key changes", async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const cleanup: string[] = []
      let setKey: (key: string) => void = () => undefined
      let manager: { schedule(): void; sync(): void } | undefined
      const dispose = createRoot((dispose) => {
        const [key, set] = createSignal("first")
        setKey = (value) => set(value)
        manager = createVcsRefreshManager({
          key,
          refresh: (value) => calls.push(value),
          cleanup: (value) => cleanup.push(value),
          wait: 100,
        })
        return dispose
      })

      manager?.schedule()
      setKey("second")
      await Promise.resolve()
      manager?.schedule()
      dispose()
      vi.advanceTimersByTime(100)
      await Promise.resolve()

      expect(calls).toEqual([])
      expect(cleanup).toEqual(["first", "second"])
    } finally {
      vi.useRealTimers()
    }
  })

  test("clears pending VCS query cache entries on cleanup before refresh", async () => {
    vi.useFakeTimers()
    try {
      const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false } } })
      const first = ["session-vcs", "first"] as const
      const second = ["session-vcs", "second"] as const
      client.setQueryData([...first, "main", "main", "git"], ["old-first"])
      client.setQueryData([...second, "main", "main", "git"], ["old-second"])
      let setKey: (key: readonly string[]) => void = () => undefined
      let manager: { schedule(): void; sync(): void } | undefined
      const dispose = createRoot((dispose) => {
        const [key, set] = createSignal<readonly string[]>(first)
        setKey = (value) => set(() => value)
        manager = createVcsRefreshManager({
          key,
          refresh: (queryKey) => client.invalidateQueries({ queryKey }),
          cleanup: (queryKey) => client.removeQueries({ queryKey }),
          wait: 100,
        })
        return dispose
      })

      manager?.schedule()
      setKey(second)
      manager?.schedule()
      dispose()
      vi.advanceTimersByTime(100)
      await Promise.resolve()

      expect(client.getQueryData([...first, "main", "main", "git"])).toBeUndefined()
      expect(client.getQueryData([...second, "main", "main", "git"])).toBeUndefined()
      client.clear()
    } finally {
      vi.useRealTimers()
    }
  })

  test("removes stale VCS cache for superseded pending keys", async () => {
    vi.useFakeTimers()
    try {
      const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false } } })
      const first = ["session-vcs", "first"] as const
      const second = ["session-vcs", "second"] as const
      client.setQueryData([...first, "main", "main", "git"], ["old-first"])
      client.setQueryData([...second, "main", "main", "git"], ["old-second"])
      let setKey: (key: readonly string[]) => void = () => undefined
      let manager: { schedule(): void; sync(): void } | undefined
      const dispose = createRoot((dispose) => {
        const [key, set] = createSignal<readonly string[]>(first)
        setKey = (value) => set(() => value)
        manager = createVcsRefreshManager({
          key,
          refresh: (queryKey) => client.invalidateQueries({ queryKey }),
          cleanup: (queryKey) => client.removeQueries({ queryKey }),
          wait: 100,
        })
        return dispose
      })

      manager?.schedule()
      setKey(second)
      manager?.schedule()
      vi.advanceTimersByTime(100)
      await Promise.resolve()

      expect(client.getQueryData([...first, "main", "main", "git"])).toBeUndefined()
      expect(client.getQueryData<string[]>([...second, "main", "main", "git"])).toEqual(["old-second"])
      dispose()
      client.clear()
    } finally {
      vi.useRealTimers()
    }
  })

  test("cleans a superseded pending key even without another schedule call", async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const cleanup: string[] = []
      let setKey: (key: string) => void = () => undefined
      let manager: { schedule(): void; sync(): void } | undefined
      const dispose = createRoot((dispose) => {
        const [key, set] = createSignal("first")
        setKey = (value) => set(value)
        manager = createVcsRefreshManager({
          key,
          refresh: (value) => calls.push(value),
          cleanup: (value) => cleanup.push(value),
          wait: 100,
        })
        return dispose
      })

      manager?.schedule()
      setKey("second")
      manager?.sync()
      await Promise.resolve()
      vi.advanceTimersByTime(100)
      await Promise.resolve()

      expect(calls).toEqual([])
      expect(cleanup).toEqual(["first"])
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("isGitMetadataPath", () => {
  test("matches relative, absolute, and windows git metadata paths", () => {
    expect(isGitMetadataPath(".git")).toBe(true)
    expect(isGitMetadataPath(".git/HEAD")).toBe(true)
    expect(isGitMetadataPath("/repo/.git")).toBe(true)
    expect(isGitMetadataPath("/repo/.git/worktrees/feature/HEAD")).toBe(true)
    expect(isGitMetadataPath("C:\\repo\\.git")).toBe(true)
    expect(isGitMetadataPath("C:\\repo\\.git\\worktrees\\feature\\HEAD")).toBe(true)
  })

  test("does not match regular file paths containing git in the name", () => {
    expect(isGitMetadataPath("src/git/index.ts")).toBe(false)
    expect(isGitMetadataPath("src/.github/workflows/test.yml")).toBe(false)
  })
})

describe("isGitHeadPath", () => {
  test("matches main and worktree git HEAD signal paths", () => {
    expect(isGitHeadPath(".git/HEAD")).toBe(true)
    expect(isGitHeadPath(".git/logs/HEAD")).toBe(true)
    expect(isGitHeadPath("/repo/.git/HEAD")).toBe(true)
    expect(isGitHeadPath("/repo/.git/logs/HEAD")).toBe(true)
    expect(isGitHeadPath("/repo/.git/worktrees/feature/HEAD")).toBe(true)
    expect(isGitHeadPath("/repo/.git/worktrees/feature/logs/HEAD")).toBe(true)
    expect(isGitHeadPath("C:\\repo\\.git\\HEAD")).toBe(true)
    expect(isGitHeadPath("C:\\repo\\.git\\logs\\HEAD")).toBe(true)
    expect(isGitHeadPath("C:\\repo\\.git\\worktrees\\feature\\HEAD")).toBe(true)
    expect(isGitHeadPath("C:\\repo\\.git\\worktrees\\feature\\logs\\HEAD")).toBe(true)
  })

  test("does not match non-HEAD git metadata paths or regular HEAD files", () => {
    expect(isGitHeadPath(".git/index")).toBe(false)
    expect(isGitHeadPath("/repo/.git/refs/heads/dev")).toBe(false)
    expect(isGitHeadPath("src/HEAD")).toBe(false)
  })
})

describe("createSessionTabs", () => {
  test("normalizes the effective file tab", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["file://src/a.ts", "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
        normalizeTab: (tab) => (tab.startsWith("file://") ? `norm:${tab.slice("file://".length)}` : tab),
      })

      expect(result.activeTab()).toBe("norm:src/a.ts")
      expect(result.activeFileTab()).toBe("norm:src/a.ts")
      expect(result.closableTab()).toBe("norm:src/a.ts")
      dispose()
    })
  })

  test("prefers context and review fallbacks when no file tab is active", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("context")
      expect(result.closableTab()).toBe("context")
      dispose()
    })

    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: [],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("review")
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBeUndefined()
      dispose()
    })
  })
})

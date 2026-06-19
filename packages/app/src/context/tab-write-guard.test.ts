import { describe, expect, test } from "bun:test"
import { createTabWriteGuard } from "./tab-write-guard"

const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe("tab write guard (layout tabsWriting)", () => {
  test("tabsWriting is true synchronously inside a tab write and false after a microtask", async () => {
    const guard = createTabWriteGuard()
    expect(guard.tabsWriting()).toBe(false)

    let insideDuringWrite: boolean | undefined
    guard.runTabWrite(() => {
      insideDuringWrite = guard.tabsWriting()
    })

    expect(insideDuringWrite).toBe(true)
    expect(guard.tabsWriting()).toBe(true)

    await microtask()
    expect(guard.tabsWriting()).toBe(false)
  })

  test("nested writes stay guarded until all have flushed", async () => {
    const guard = createTabWriteGuard()
    guard.runTabWrite(() => {
      guard.runTabWrite(() => {})
      expect(guard.tabsWriting()).toBe(true)
    })
    expect(guard.tabsWriting()).toBe(true)

    await microtask()
    expect(guard.tabsWriting()).toBe(false)
  })

  test("onChange feedback during a programmatic write is ignored; genuine onChange is honored", async () => {
    const guard = createTabWriteGuard()
    let active = "review"

    const openTab = (value: string) => {
      active = value
    }
    const onTabsChange = (value: string) => {
      if (guard.tabsWriting()) return
      openTab(value)
    }

    // Programmatically open a file tab; Kobalte re-emits onChange("review") while
    // it reconciles. That stale feedback must NOT revert the active tab.
    guard.runTabWrite(() => openTab("file://src/a.ts"))
    onTabsChange("review")
    expect(active).toBe("file://src/a.ts")

    // After the write flushes, a genuine user onChange IS honored.
    await microtask()
    onTabsChange("review")
    expect(active).toBe("review")
  })
})

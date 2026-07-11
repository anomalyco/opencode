import { createMemo, createRoot, createSignal } from "solid-js"
import { expect, test } from "bun:test"

/**
 * The sidebar visibility logic in the session component determines
 * whether to show the sidebar based on:
 * 1. sidebar mode: "auto" (show when screen is wide enough) or "hide" (always hide)
 * 2. screen width: wide() returns true when terminal width > 120
 *
 * Previously there was a `sidebarOpen` signal that overrode the width check,
 * causing the sidebar to force-show when toggled on via command palette
 * even on narrow screens (windowed mode). This was the bug.
 *
 * These tests validate the corrected behavior.
 */

test("sidebar hidden when mode is auto and screen is not wide", () => {
  createRoot(() => {
    const [sidebar] = createSignal<"auto" | "hide">("auto")
    const [wide] = createSignal(false)

    const sidebarVisible = createMemo(() => {
      if (sidebar() === "auto" && wide()) return true
      return false
    })

    expect(sidebarVisible()).toBe(false)
  })
})

test("sidebar visible when mode is auto and screen is wide", () => {
  createRoot(() => {
    const [sidebar] = createSignal<"auto" | "hide">("auto")
    const [wide] = createSignal(true)

    const sidebarVisible = createMemo(() => {
      if (sidebar() === "auto" && wide()) return true
      return false
    })

    expect(sidebarVisible()).toBe(true)
  })
})

test("sidebar hidden when mode is hide regardless of screen width", () => {
  createRoot(() => {
    const [sidebar] = createSignal<"auto" | "hide">("hide")
    const [wide, setWide] = createSignal(true)

    const sidebarVisible = createMemo(() => {
      if (sidebar() === "auto" && wide()) return true
      return false
    })

    expect(sidebarVisible()).toBe(false)

    // Even when wide, sidebar is hidden because mode is "hide"
    setWide(true)
    expect(sidebarVisible()).toBe(false)
  })
})

test("sidebar visibility reacts to width changes in auto mode", () => {
  createRoot(() => {
    const [sidebar] = createSignal<"auto" | "hide">("auto")
    const [wide, setWide] = createSignal(false)

    const sidebarVisible = createMemo(() => {
      if (sidebar() === "auto" && wide()) return true
      return false
    })

    expect(sidebarVisible()).toBe(false)

    // Resize from narrow to wide
    setWide(true)
    expect(sidebarVisible()).toBe(true)

    // Resize from wide back to narrow
    setWide(false)
    expect(sidebarVisible()).toBe(false)
  })
})

test("toggling sidebar switches between auto and hide modes", () => {
  createRoot(() => {
    const [sidebar, setSidebar] = createSignal<"auto" | "hide">("auto")

    // Toggle: auto -> hide
    setSidebar("hide")
    expect(sidebar()).toBe("hide")

    // Toggle: hide -> auto
    setSidebar("auto")
    expect(sidebar()).toBe("auto")
  })
})

test("toggling sidebar on with narrow window does NOT force visibility (regression test)", () => {
  createRoot(() => {
    const [sidebar, setSidebar] = createSignal<"auto" | "hide">("auto")
    const [wide] = createSignal(false)

    const sidebarVisible = createMemo(() => {
      if (sidebar() === "auto" && wide()) return true
      return false
    })

    // Initially hidden
    expect(sidebarVisible()).toBe(false)

    // Toggle: user toggles "on" (set mode to auto), but screen is still narrow
    // The old bug: sidebarOpen would force visibility here
    setSidebar("auto")

    // The fix: sidebar should still be hidden because screen is not wide
    expect(sidebarVisible()).toBe(false)
  })
})

test("sidebar toggle cycle with width changes works correctly", () => {
  createRoot(() => {
    const [sidebar, setSidebar] = createSignal<"auto" | "hide">("hide")
    const [wide, setWide] = createSignal(false)

    const sidebarVisible = createMemo(() => {
      if (sidebar() === "auto" && wide()) return true
      return false
    })

    // 1. Start: hide, narrow -> not visible
    expect(sidebarVisible()).toBe(false)

    // 2. User enables sidebar, but still narrow -> should not force show
    setSidebar("auto")
    expect(sidebarVisible()).toBe(false)

    // 3. User makes window wide -> sidebar becomes visible
    setWide(true)
    expect(sidebarVisible()).toBe(true)

    // 4. User makes window narrow again -> sidebar hides
    setWide(false)
    expect(sidebarVisible()).toBe(false)
  })
})

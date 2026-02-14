import { afterEach, describe, expect, test, vi } from "vitest"
import { render, waitFor, cleanup } from "@solidjs/testing-library"
import { type JSX, batch, createSignal, onCleanup, onMount } from "solid-js"

// ---------------------------------------------------------------------------
// Integration Test 2: Portal mount/unmount tracking
//
// Uses a Terminal mock that tracks mount/unmount counts to verify:
//   - Switching focus between terminals doesn't cause extra unmount cycles
//   - Split toggle (hide/show) doesn't destroy and recreate terminals
//   - Portal host rebinding doesn't trigger <Show keyed> remount
//   - Changing active tab swaps visibility, not mount state
// ---------------------------------------------------------------------------

type Tab = {
  id: string
  type: "session" | "terminal" | "review" | "file"
  directory: string
  title: string
  terminalId?: string
  closable: boolean
}

type Pane = { t: "leaf"; id: string } | { t: "split"; dir: "h" | "v"; a: Pane; b: Pane; size: number }
type Pty = { id: string; title: string; cwd?: string }

let groupId: string | undefined
let claxedo: any
let terminalCtx: any
let sdkDirectory = "/ws"

// Mount/unmount counters per PTY ID
const mountCounts = new Map<string, number>()
const unmountCounts = new Map<string, number>()
const mountTimestamps = new Map<string, number[]>()
const unmountTimestamps = new Map<string, number[]>()

function resetCounters() {
  mountCounts.clear()
  unmountCounts.clear()
  mountTimestamps.clear()
  unmountTimestamps.clear()
}

vi.mock("../context/group-id", () => ({
  useGroupId: () => groupId,
}))

vi.mock("../context/claxedo-layout", () => ({
  useClaxedoLayout: () => claxedo,
}))

vi.mock("@/context/terminal", () => ({
  useTerminal: () => terminalCtx,
}))

vi.mock("@/context/sdk", () => ({
  useSDK: () => ({ directory: sdkDirectory }),
}))

// Terminal mock with lifecycle tracking
vi.mock("@/components/terminal", () => ({
  Terminal: (props: { pty: Pty; onSplitVertical?: () => void; onSplitHorizontal?: () => void }) => {
    const id = props.pty.id

    onMount(() => {
      mountCounts.set(id, (mountCounts.get(id) ?? 0) + 1)
      const ts = mountTimestamps.get(id) ?? []
      ts.push(Date.now())
      mountTimestamps.set(id, ts)
    })

    onCleanup(() => {
      unmountCounts.set(id, (unmountCounts.get(id) ?? 0) + 1)
      const ts = unmountTimestamps.get(id) ?? []
      ts.push(Date.now())
      unmountTimestamps.set(id, ts)
    })

    return (
      <div
        data-testid="terminal"
        data-pty={id}
        data-component="terminal"
        tabIndex={0}
        onKeyDown={(event: KeyboardEvent) => {
          if (!event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key.toLowerCase() !== "d") return
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) {
            props.onSplitHorizontal?.()
            return
          }
          props.onSplitVertical?.()
        }}
      >
        {props.pty.title}
      </div>
    )
  },
}))

vi.mock("@opencode-ai/ui/icon", () => ({
  Icon: () => <span data-testid="icon" />,
}))

vi.mock("@opencode-ai/ui/icon-button", () => ({
  IconButton: (props: { onClick?: () => void; ["aria-label"]?: string }) => (
    <button onClick={props.onClick}>{props["aria-label"] ?? "icon-button"}</button>
  ),
}))

import { ClaxedoDirectoryProvider } from "./terminal-content-wrapper"
import { getTabHostId } from "./tab-content-area"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
  groupId = undefined
  sdkDirectory = "/ws"
  resetCounters()
})

function terminalStoreSignal(initial: Pty[]) {
  const [all, setAll] = createSignal(initial)
  return {
    all,
    setAll,
    active: () => all()[0]?.id,
    new: vi.fn(),
    close: vi.fn(),
    update: vi.fn(),
    clone: vi.fn(),
  }
}

function makeClaxedo(input: {
  focusedId: string
  groups: Array<{ id: string; tabs: Tab[] }>
  panes: Record<string, Pane | undefined>
  creating?: number
  creatingGroupId?: string
  owners?: Record<string, string | undefined>
  lifecycles?: Record<string, "creating" | "attaching" | "attached" | "closing" | "closed" | undefined>
  hidden?: boolean
}) {
  const [hidden, setHidden] = createSignal(!!input.hidden)
  const [paneVersion, setPaneVersion] = createSignal(0)
  const [focusVersion, setFocusVersion] = createSignal(0)
  const [tabVersion, setTabVersion] = createSignal(0)
  const state = {
    focusedId: input.focusedId,
    groups: input.groups,
    pane: { ...input.panes } as Record<string, Pane | undefined>,
    focus: {} as Record<string, string | undefined>,
    zoom: {} as Record<string, string | undefined>,
    owner: { ...(input.owners ?? {}) } as Record<string, string | undefined>,
    lifecycle: { ...(input.lifecycles ?? {}) } as Record<
      string,
      "creating" | "attaching" | "attached" | "closing" | "closed" | undefined
    >,
    splitPendingTab: undefined as string | undefined,
    closing: new Set<string>(),
  }

  const ids = (node: Pane | undefined): string[] => {
    if (!node) return []
    if (node.t === "leaf") return [node.id]
    return [...ids(node.a), ...ids(node.b)]
  }

  const g = (id: string) => state.groups.find((x) => x.id === id)

  const topTabs = {
    items: () => { tabVersion(); return g(state.focusedId)?.tabs ?? [] },
    active: () => {
      tabVersion()
      const items = g(state.focusedId)?.tabs ?? []
      return items[0]
    },
    addTerminal: vi.fn(() => ""),
    close: vi.fn(),
    patch: vi.fn(),
  }

  return {
    split: {
      groups: () => state.groups.map((x) => ({ id: x.id })),
      hidden,
      _setHidden: setHidden,
      toggle: vi.fn(),
    },
    topTabs,
    groupTabs: (id: string) => ({
      items: () => { tabVersion(); return g(id)?.tabs ?? [] },
      active: () => { tabVersion(); return (g(id)?.tabs ?? [])[0] },
      addTerminal: vi.fn(() => ""),
      close: vi.fn(),
      patch: vi.fn(),
    }),
    findTabGroup: (tabId: string) => { tabVersion(); return state.groups.find((x) => x.tabs.some((t) => t.id === tabId))?.id },
    terminal: {
      pendingCreate: () => 0,
      pendingDir: () => undefined,
      consumePendingCommand: () => ({ command: undefined, title: undefined }),
      clearPendingCreate: vi.fn(),
      creating: () => input.creating ?? 0,
      creatingGroupId: () => input.creatingGroupId,
      splitPendingTab: () => state.splitPendingTab,
      beginSplit: (tab: string) => { state.splitPendingTab = tab },
      clearSplitPending: (tab?: string) => {
        if (!tab || state.splitPendingTab === tab) state.splitPendingTab = undefined
      },
      isClosing: (id: string) => state.closing.has(id),
      beginClosing: (id: string) => { state.closing.add(id) },
      clearClosing: (id: string) => { state.closing.delete(id) },
      lifecycle: (id: string) => state.lifecycle[id],
      transitionLifecycle: vi.fn(
        (id: string, next: "creating" | "attaching" | "attached" | "closing" | "closed") => {
          state.lifecycle[id] = next
          return true
        },
      ),
      created: vi.fn(),
      owner: (id: string) => state.owner[id],
      own: (tab: string, id: string) => { state.owner[id] = tab },
      disown: (id: string) => { state.owner[id] = undefined },
      pane: (tab: string) => { paneVersion(); return state.pane[tab] },
      ids: (tab: string) => { paneVersion(); return ids(state.pane[tab]) },
      ensure: (tab: string, id: string) => {
        if (state.pane[tab]) return
        state.pane[tab] = { t: "leaf", id }
        state.focus[tab] = id
        setPaneVersion(v => v + 1)
        setFocusVersion(v => v + 1)
      },
      focus: (tab: string) => { focusVersion(); return state.focus[tab] },
      setFocus: (tab: string, id: string) => { state.focus[tab] = id; setFocusVersion(v => v + 1) },
      zoom: (tab: string) => state.zoom[tab],
      setZoom: (tab: string, id: string | undefined) => { state.zoom[tab] = id },
      focusInTab: vi.fn((input: { tab: string; id: string }) => {
        state.focus[input.tab] = input.id
        state.zoom[input.tab] = undefined
        setFocusVersion(v => v + 1)
      }),
      zoomInTab: vi.fn((input: { tab: string; id: string }) => {
        state.zoom[input.tab] = state.zoom[input.tab] === input.id ? undefined : input.id
      }),
      splitInTab: vi.fn(),
      closeInTab: vi.fn(),
      detachFromTab: vi.fn((input: { tab: string; id: string }) => {
        state.owner[input.id] = undefined
      }),
      split: vi.fn(),
      close: vi.fn(),
      path: vi.fn(),
      resize: vi.fn(),
      swap: vi.fn(),
      clear: vi.fn(),
    },
    _setPaneTree: (tab: string, p: Pane | undefined) => {
      state.pane[tab] = p
      setPaneVersion(v => v + 1)
    },
    _mutatePane: (tab: string, fn: (p: Pane) => void) => {
      const p = state.pane[tab]
      if (p) fn(p)
      setPaneVersion(v => v + 1)
    },
    _setGroupTabs: (gid: string, tabs: Tab[]) => {
      const group = state.groups.find((x) => x.id === gid)
      if (group) group.tabs = tabs
      setTabVersion((v) => v + 1)
    },
    /** Simulate real clearTerminalTabState + tab removal (production close flow) */
    _closeTabWithCleanup: (gid: string, tabId: string) => {
      // 1. Collect all IDs from pane tree + tab.terminalId + owned terminals
      const paneIds = ids(state.pane[tabId])
      const group = state.groups.find((x) => x.id === gid)
      const tabTerminal = group?.tabs.find((t) => t.id === tabId && t.type === "terminal")
      const tabIds = tabTerminal?.terminalId ? [tabTerminal.terminalId] : []
      const owned = Object.entries(state.owner)
        .filter(([, v]) => v === tabId)
        .map(([k]) => k)
      const allIds = [...new Set([...paneIds, ...tabIds, ...owned])]

      // 2. Clear focus, zoom, owner for all IDs
      state.focus[tabId] = undefined
      state.zoom[tabId] = undefined
      for (const id of allIds) {
        state.owner[id] = undefined
        // 3. Set lifecycle to "closing" (not undefined — matches fixed clearTerminalTabState)
        state.lifecycle[id] = "closing"
      }
      // 4. Keep pane tree (matches fixed clearTerminalTabState — pane NOT cleared here)

      // 5. Remove tab from group
      if (group) group.tabs = group.tabs.filter((t) => t.id !== tabId)
      // 6. Bump tabVersion signal
      setTabVersion((v) => v + 1)
    },
  }
}

function mountApp(ui: () => JSX.Element) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  return render(ui, { container: root })
}

function createHost(tabId: string, groupId?: string) {
  const host = document.createElement("div")
  host.id = getTabHostId(tabId)
  if (groupId) host.dataset.claxedoGroupId = groupId
  document.body.appendChild(host)
  return host
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("terminal mount/unmount tracking during focus operations", () => {
  test("initial render mounts terminal exactly once", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    createHost(tab.id)
    terminalCtx = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
    })

    // No unmounts should have happened
    expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
  })

  test("two terminals in split mount exactly once each", async () => {
    const tab1: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    const tab2: Tab = {
      id: "tab-2",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-2",
      title: "Claude 2",
      closable: true,
    }
    createHost(tab1.id)
    createHost(tab2.id)
    terminalCtx = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [
        { id: "g1", tabs: [tab1] },
        { id: "g2", tabs: [tab2] },
      ],
      panes: {
        "tab-1": { t: "leaf", id: "pty-1" },
        "tab-2": { t: "leaf", id: "pty-2" },
      },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
    expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
  })

  test("split toggle (hide/show) does not unmount terminals", async () => {
    const tab1: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    const tab2: Tab = {
      id: "tab-2",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-2",
      title: "Claude 2",
      closable: true,
    }
    const host1 = createHost(tab1.id)
    const host2 = createHost(tab2.id)
    terminalCtx = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [
        { id: "g1", tabs: [tab1] },
        { id: "g2", tabs: [tab2] },
      ],
      panes: {
        "tab-1": { t: "leaf", id: "pty-1" },
        "tab-2": { t: "leaf", id: "pty-2" },
      },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Toggle split hidden (simulates mod+\ to hide split)
    claxedo.split._setHidden(true)

    // Wait a tick for reactivity to settle
    await waitFor(() => {
      // Mount counts should NOT increase (no remount)
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Toggle split visible again
    claxedo.split._setHidden(false)

    await waitFor(() => {
      // Still no extra mounts
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
      // And no unmounts happened
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
    })
  })

  test("portal host removal and re-insertion does not cause extra mount cycles", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    const host = createHost(tab.id)
    terminalCtx = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
    })

    const mountsBefore = mountCounts.get("pty-1")!
    const unmountsBefore = unmountCounts.get("pty-1") ?? 0

    // Simulate host DOM re-insertion (what happens when split layout changes)
    host.remove()
    document.body.appendChild(host)

    // Trigger portal host detection by toggling split state
    claxedo.split._setHidden(true)
    claxedo.split._setHidden(false)

    // Give reactivity and RAF loop time to settle
    await new Promise<void>((r) => setTimeout(r, 100))

    await waitFor(() => {
      // The terminal should NOT have been remounted
      const mountsAfter = mountCounts.get("pty-1")!
      const unmountsAfter = unmountCounts.get("pty-1") ?? 0
      // At most 1 extra mount cycle is acceptable (portal may need to rebind)
      // but 0 is ideal — the portal should move, not recreate
      expect(mountsAfter - mountsBefore).toBeLessThanOrEqual(1)
      // If there was a remount, unmount count should match
      if (mountsAfter > mountsBefore) {
        expect(unmountsAfter - unmountsBefore).toBe(mountsAfter - mountsBefore)
      }
    })
  })

  test("adding new terminal via store update causes at most one remount of existing terminal", async () => {
    // BUG SIGNAL: When terminal.all() changes (new PTY added), the detection
    // effect in TerminalContentWrapperInner re-runs. This can cause renderState()
    // to change its key, triggering <Show keyed> to unmount/remount existing
    // terminals even though their pane tree hasn't changed.
    //
    // Ideal: mountCounts.get("pty-1") stays at 1 (zero extra mounts)
    // Current: mountCounts.get("pty-1") goes to 2 (one spurious remount)
    //
    // This test documents the current behavior and will catch regressions
    // if the remount count increases further.
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    const host = createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
    })

    // Simulate: new terminal arrives in store (e.g. from split or background create)
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])

    // Simulate pane update (normally done by splitInTab reducer)
    claxedo.terminal.ensure("tab-1", "pty-2")

    await waitFor(() => {
      const mounts = mountCounts.get("pty-1")!
      // renderState() is now structurally stable — same pane + same host = same
      // object reference, so <Show keyed> does not remount existing terminals.
      expect(mounts).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Split / pane operation mount stability tests
//
// These tests exercise the reactive paths triggered by in-tab pane splits,
// resizes, pane closes, and focus switches. They document which operations
// cause spurious remounts (visible flicker / UI freeze) and which are stable.
// ---------------------------------------------------------------------------

describe("terminal mount stability during pane split operations", () => {
  test("in-tab vertical split preserves existing terminal (no remount)", async () => {
    // FlatPaneRenderer uses <For> with stable leaf IDs, so when a leaf pane
    // becomes a split, the existing terminal stays mounted — no teardown/rebuild.
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Term 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => expect(mountCounts.get("pty-1")).toBe(1))

    // Simulate vertical split: add pty-2 to store and change pane tree
    batch(() => {
      store.setAll([
        { id: "pty-1", title: "Term 1", cwd: "/ws" },
        { id: "pty-2", title: "Term 2", cwd: "/ws" },
      ])
      claxedo._setPaneTree("tab-1", {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      })
    })

    await waitFor(() => {
      // pty-1 stays mounted: <For> preserves element for unchanged leaf ID
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      // pty-2 mounts for the first time
      expect(mountCounts.get("pty-2")).toBe(1)
      expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
    })
  })

  test("pane resize (drag handle) does not remount any terminal", async () => {
    // Resize only changes `size` on the split node. The pane object reference
    // stays the same (in-place mutation), so paneRoot() memo returns the cached
    // value and renderState stays stable. Zero remounts.
    const splitPane: Pane = {
      t: "split",
      dir: "v",
      a: { t: "leaf", id: "pty-1" },
      b: { t: "leaf", id: "pty-2" },
      size: 0.5,
    }
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": splitPane },
      owners: { "pty-2": "tab-1" },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Simulate resize drag: mutate size in place (same object reference)
    claxedo._mutatePane("tab-1", (p: Pane) => {
      if (p.t === "split") (p as any).size = 0.7
    })

    await new Promise<void>((r) => setTimeout(r, 50))

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
    })
  })

  test("closing one pane from split preserves surviving terminal (no remount)", async () => {
    // FlatPaneRenderer uses <For> — collapsing split→leaf only removes the
    // closed leaf; the surviving leaf stays mounted.
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {
        "tab-1": {
          t: "split",
          dir: "v",
          a: { t: "leaf", id: "pty-1" },
          b: { t: "leaf", id: "pty-2" },
          size: 0.5,
        },
      },
      owners: { "pty-2": "tab-1" },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Close pty-2: remove from store and collapse pane tree to leaf
    batch(() => {
      store.setAll([{ id: "pty-1", title: "Term 1", cwd: "/ws" }])
      claxedo._setPaneTree("tab-1", { t: "leaf", id: "pty-1" })
    })

    await waitFor(() => {
      // pty-1 stays mounted: <For> preserves element for unchanged leaf ID
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      // pty-2 was unmounted when removed from the leaf list
      expect(unmountCounts.get("pty-2")).toBe(1)
    })
  })

  test("focus switch between panes in same tab causes zero remounts", async () => {
    // Focus changes update claxedo.terminal.focus() but don't touch paneRoot
    // or host → renderState is stable → no remounts.
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {
        "tab-1": {
          t: "split",
          dir: "v",
          a: { t: "leaf", id: "pty-1" },
          b: { t: "leaf", id: "pty-2" },
          size: 0.5,
        },
      },
      owners: { "pty-2": "tab-1" },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Switch focus from pty-1 to pty-2
    claxedo.terminal.focusInTab({ tab: "tab-1", id: "pty-2" })
    await new Promise<void>((r) => setTimeout(r, 50))

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
    })

    // Switch back
    claxedo.terminal.focusInTab({ tab: "tab-1", id: "pty-1" })
    await new Promise<void>((r) => setTimeout(r, 50))

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })
  })

  test("rapid successive PTY additions to store cause zero remounts", async () => {
    // Multiple store.setAll() calls each trigger map() change, but paneRoot
    // and host stay the same → structurally-stable renderState prevents remounts.
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Term 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => expect(mountCounts.get("pty-1")).toBe(1))

    // Rapid fire: 3 successive store updates
    store.setAll([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
    ])
    store.setAll([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
      { id: "pty-3", title: "Term 3", cwd: "/ws" },
    ])
    store.setAll([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
      { id: "pty-3", title: "Term 3", cwd: "/ws" },
      { id: "pty-4", title: "Term 4", cwd: "/ws" },
    ])

    await new Promise<void>((r) => setTimeout(r, 50))

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
    })
  })

  test("cross-tab PTY addition does not remount other tab's terminal", async () => {
    // Two separate tabs in different groups. Adding a PTY that belongs to
    // neither tab's pane tree should not cause any portal to remount.
    const tab1: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    const tab2: Tab = {
      id: "tab-2",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-2",
      title: "Term 2",
      closable: true,
    }
    createHost(tab1.id)
    createHost(tab2.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [
        { id: "g1", tabs: [tab1] },
        { id: "g2", tabs: [tab2] },
      ],
      panes: {
        "tab-1": { t: "leaf", id: "pty-1" },
        "tab-2": { t: "leaf", id: "pty-2" },
      },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Add pty-3 to store (not in any tab's pane tree)
    store.setAll([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
      { id: "pty-3", title: "Term 3", cwd: "/ws" },
    ])

    await new Promise<void>((r) => setTimeout(r, 50))

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
    })
  })

  test("consecutive splits cause zero remounts (no cascading jank)", async () => {
    // FlatPaneRenderer uses <For> with stable leaf IDs, so each split
    // only adds a new terminal without remounting existing ones.
    // No cascading jank regardless of split count.
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Term 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => expect(mountCounts.get("pty-1")).toBe(1))

    // First split: leaf(pty-1) → split(pty-1, pty-2)
    batch(() => {
      store.setAll([
        { id: "pty-1", title: "Term 1", cwd: "/ws" },
        { id: "pty-2", title: "Term 2", cwd: "/ws" },
      ])
      claxedo._setPaneTree("tab-1", {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      })
    })

    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1) // preserved
      expect(mountCounts.get("pty-2")).toBe(1) // fresh mount
    })

    // Second split: split(pty-1, pty-2) → split(split(pty-1, pty-3), pty-2)
    batch(() => {
      store.setAll([
        { id: "pty-1", title: "Term 1", cwd: "/ws" },
        { id: "pty-2", title: "Term 2", cwd: "/ws" },
        { id: "pty-3", title: "Term 3", cwd: "/ws" },
      ])
      claxedo._setPaneTree("tab-1", {
        t: "split",
        dir: "v",
        a: {
          t: "split",
          dir: "h",
          a: { t: "leaf", id: "pty-1" },
          b: { t: "leaf", id: "pty-3" },
          size: 0.5,
        },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      })
    })

    await waitFor(() => {
      // All terminals mounted exactly once — zero remounts
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(unmountCounts.get("pty-1") ?? 0).toBe(0)
      expect(mountCounts.get("pty-2")).toBe(1)
      expect(unmountCounts.get("pty-2") ?? 0).toBe(0)
      expect(mountCounts.get("pty-3")).toBe(1)
      expect(unmountCounts.get("pty-3") ?? 0).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Tab close integration: closing a tab with child split panes
//
// Verifies that when a main terminal tab is closed, ALL terminals in its
// pane tree (main + children from splits) are killed and unmounted.
// ---------------------------------------------------------------------------

describe("tab close kills all pane terminals", () => {
  test("closing main tab with child split pane kills both terminals", async () => {
    // Setup: tab-1 has pty-1 as main terminal, pty-2 as child via split pane
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {
        "tab-1": {
          t: "split",
          dir: "v",
          a: { t: "leaf", id: "pty-1" },
          b: { t: "leaf", id: "pty-2" },
          size: 0.5,
        },
      },
      owners: { "pty-2": "tab-1" },
      lifecycles: { "pty-1": "attached", "pty-2": "attached" },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    // Wait for both terminals to mount
    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
    })

    // Close the tab using production-accurate cleanup (preserves pane, sets lifecycle "closing")
    claxedo._closeTabWithCleanup("g1", "tab-1")

    // The close effect should kill BOTH terminals via pane tree lookup:
    // 1. pty-1 is in terminalsWithTabs → tab gone → close(pty-1)
    // 2. claxedo.terminal.ids("tab-1") returns ["pty-1","pty-2"] → close(pty-2)
    await waitFor(() => {
      expect(store.close).toHaveBeenCalledWith("pty-1")
      expect(store.close).toHaveBeenCalledWith("pty-2")
    })

    // Pane state should be cleared via clear()
    expect(claxedo.terminal.clear).toHaveBeenCalledWith("tab-1")

    // addTerminal must NOT be called — no orphan tab should appear
    expect(claxedo.topTabs.addTerminal).not.toHaveBeenCalled()

    // Simulate terminal store cleanup (what terminal.close does server-side)
    store.setAll([])

    // Both terminals should unmount
    await waitFor(() => {
      expect(unmountCounts.get("pty-1")).toBeGreaterThanOrEqual(1)
      expect(unmountCounts.get("pty-2")).toBeGreaterThanOrEqual(1)
    })
  })

  test("closing tab with deeply nested pane tree kills all terminals", async () => {
    // Setup: tab-1 has 3 terminals in a nested split:
    //   split(v, split(h, pty-1, pty-2), pty-3)
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Term 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Term 1", cwd: "/ws" },
      { id: "pty-2", title: "Term 2", cwd: "/ws" },
      { id: "pty-3", title: "Term 3", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {
        "tab-1": {
          t: "split",
          dir: "v",
          a: {
            t: "split",
            dir: "h",
            a: { t: "leaf", id: "pty-1" },
            b: { t: "leaf", id: "pty-2" },
            size: 0.5,
          },
          b: { t: "leaf", id: "pty-3" },
          size: 0.5,
        },
      },
      owners: { "pty-2": "tab-1", "pty-3": "tab-1" },
      lifecycles: { "pty-1": "attached", "pty-2": "attached", "pty-3": "attached" },
    })

    mountApp(() => <ClaxedoDirectoryProvider />)

    // Wait for all three terminals to mount
    await waitFor(() => {
      expect(mountCounts.get("pty-1")).toBe(1)
      expect(mountCounts.get("pty-2")).toBe(1)
      expect(mountCounts.get("pty-3")).toBe(1)
    })

    // Close the tab using production-accurate cleanup
    claxedo._closeTabWithCleanup("g1", "tab-1")

    // All three should be killed
    await waitFor(() => {
      expect(store.close).toHaveBeenCalledWith("pty-1")
      expect(store.close).toHaveBeenCalledWith("pty-2")
      expect(store.close).toHaveBeenCalledWith("pty-3")
    })

    expect(claxedo.terminal.clear).toHaveBeenCalledWith("tab-1")

    // No orphan tabs created
    expect(claxedo.topTabs.addTerminal).not.toHaveBeenCalled()

    // Simulate store cleanup
    store.setAll([])

    await waitFor(() => {
      expect(unmountCounts.get("pty-1")).toBeGreaterThanOrEqual(1)
      expect(unmountCounts.get("pty-2")).toBeGreaterThanOrEqual(1)
      expect(unmountCounts.get("pty-3")).toBeGreaterThanOrEqual(1)
    })
  })
})

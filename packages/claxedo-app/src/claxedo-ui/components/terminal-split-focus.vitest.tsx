/**
 * Terminal split → focus integration test
 *
 * Tests what ACTUALLY happens to the Terminal component when:
 *   1. A single terminal pane is split into two
 *   2. The user clicks (focuses) the original pane
 *
 * Instead of testing the resize coordinator in isolation, this test
 * mounts the real component tree (FlatPaneRenderer, LeafNode, etc.)
 * with a mock Terminal that tracks every relevant event.
 *
 * The mock Terminal exposes:
 *   - Mount/unmount lifecycle
 *   - Container dimensions at render time
 *   - autoFocus prop
 *   - onSplitVertical/onSplitHorizontal callbacks
 *   - Every opencode:terminal-fit event received
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { render, waitFor, cleanup, fireEvent } from "@solidjs/testing-library"
import { type JSX, createSignal, createEffect, onCleanup } from "solid-js"

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

// ---- Tracking state for mock Terminal ----

/** Every Terminal mount, keyed by pty ID */
const mounts: { id: string; at: number }[] = []
/** Every opencode:terminal-fit event, with timestamp */
const fitEvents: { at: number }[] = []
/** Map from pty ID → container element ref (set on mount) */
const containerRefs = new Map<string, HTMLDivElement>()
/** Map from pty ID → number of times onSplitVertical was called */
const splitVerticalCalls = new Map<string, number>()

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

vi.mock("@/components/terminal", () => ({
  Terminal: (props: {
    pty: Pty
    autoFocus?: boolean
    onSplitVertical?: () => void
    onSplitHorizontal?: () => void
    onCleanup?: (pty: any) => void
    onUpdate?: (pty: any) => void
    onFileLinkOpen?: (path: string, line?: number, col?: number) => void
  }) => {
    const id = props.pty.id
    mounts.push({ id, at: performance.now() })

    // Listen for opencode:terminal-fit events while mounted
    const handleFit = () => {
      fitEvents.push({ at: performance.now() })
    }
    window.addEventListener("opencode:terminal-fit", handleFit)

    let containerRef!: HTMLDivElement

    // SolidJS cleanup
    onCleanup(() => {
      window.removeEventListener("opencode:terminal-fit", handleFit)
      containerRefs.delete(id)
    })

    return (
      <div
        ref={(el: HTMLDivElement) => {
          containerRef = el
          containerRefs.set(id, el)
        }}
        data-testid="terminal"
        data-pty={id}
        data-component="terminal"
        data-auto-focus={String(props.autoFocus !== false)}
        style={{ width: "100%", height: "100%" }}
      >
        {props.pty.title}
        <button
          data-testid={`split-v-${id}`}
          onClick={() => props.onSplitVertical?.()}
        >
          split-v
        </button>
      </div>
    )
  },
}))

vi.mock("@opencode-ai/ui/icon", () => ({
  Icon: () => <span data-testid="icon" />,
}))

vi.mock("@opencode-ai/ui/icon-button", () => ({
  IconButton: (props: { onClick?: () => void; "aria-label"?: string }) => (
    <button onClick={props.onClick}>{props["aria-label"] ?? "icon-button"}</button>
  ),
}))

vi.mock("../../overrides/components/attach-scheduler", () => ({
  sharedAttachScheduler: {
    schedule: (_key: string, fn: () => void) => {
      fn()
      return { promise: Promise.resolve() }
    },
  },
}))

import { ClaxedoDirectoryProvider } from "./terminal-content-wrapper"
import { getTabHostId } from "./tab-content-area"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
  groupId = undefined
  sdkDirectory = "/ws"
  mounts.length = 0
  fitEvents.length = 0
  containerRefs.clear()
  splitVerticalCalls.clear()
})

function paneIds(node: Pane | undefined): string[] {
  if (!node) return []
  if (node.t === "leaf") return [node.id]
  return [...paneIds(node.a), ...paneIds(node.b)]
}

function makeReactiveClaxedo(input: {
  focusedId: string
  groups: Array<{ id: string; tabs: Tab[] }>
  initialPanes: Record<string, Pane | undefined>
  terminalAll: () => Pty[]
}) {
  const [panes, setPanes] = createSignal(input.initialPanes)
  const state = {
    focus: {} as Record<string, string | undefined>,
    zoom: {} as Record<string, string | undefined>,
    owner: {} as Record<string, string | undefined>,
    lifecycle: {} as Record<string, string | undefined>,
    splitPendingTab: undefined as string | undefined,
    closing: new Set<string>(),
  }

  const g = (id: string) => input.groups.find((x) => x.id === id)

  const topTabs = {
    items: () => g(input.focusedId)?.tabs ?? [],
    active: () => (g(input.focusedId)?.tabs ?? [])[0],
    addTerminal: vi.fn(() => ""),
    addFile: vi.fn(() => ""),
    setActive: vi.fn(),
    close: vi.fn(),
    patch: vi.fn(),
  }

  const api = {
    enabled: () => true,
    split: {
      groups: () => input.groups.map((x) => ({ id: x.id })),
      hidden: () => false,
      active: () => input.groups.length > 1,
      toggle: vi.fn(),
    },
    topTabs,
    groupTabs: (id: string) => ({
      items: () => g(id)?.tabs ?? [],
      active: () => (g(id)?.tabs ?? [])[0],
      orderedItems: () => g(id)?.tabs ?? [],
      addTerminal: vi.fn(() => ""),
      addFile: vi.fn(() => ""),
      setActive: vi.fn(),
      close: vi.fn(),
      patch: vi.fn(),
    }),
    groupWorktree: () => ({ default: () => "/ws", pinned: () => undefined }),
    findTabGroup: (tabId: string) => input.groups.find((x) => x.tabs.some((t) => t.id === tabId))?.id,
    workspaceRecency: { recordAccess: vi.fn() },
    terminal: {
      pendingCreate: () => 0,
      pendingDir: () => undefined,
      consumePendingCommand: () => ({ command: undefined, title: undefined }),
      clearPendingCreate: vi.fn(),
      creating: () => 0,
      creatingGroupId: () => undefined,
      created: vi.fn(),
      splitPendingTab: () => state.splitPendingTab,
      beginSplit: (tab: string) => { state.splitPendingTab = tab },
      clearSplitPending: (tab?: string) => {
        if (!tab || state.splitPendingTab === tab) state.splitPendingTab = undefined
      },
      isClosing: (id: string) => state.closing.has(id),
      beginClosing: (id: string) => { state.closing.add(id) },
      clearClosing: (id: string) => { state.closing.delete(id) },
      lifecycle: (id: string) => state.lifecycle[id],
      transitionLifecycle: vi.fn((id: string, next: string) => { state.lifecycle[id] = next; return true }),
      owner: (id: string) => state.owner[id],
      own: (tab: string, id: string) => { state.owner[id] = tab },
      disown: (id: string) => { state.owner[id] = undefined },
      pane: (tab: string) => panes()[tab],
      ids: (tab: string) => paneIds(panes()[tab]),
      ensure: (tab: string, id: string) => {
        if (!state.focus[tab]) state.focus[tab] = id
      },
      focus: (tab: string) => state.focus[tab],
      setFocus: (tab: string, id: string) => { state.focus[tab] = id },
      zoom: (tab: string) => state.zoom[tab],
      zoomInTab: vi.fn(),
      focusInTab: vi.fn((input: { tab: string; id: string }) => {
        state.focus[input.tab] = input.id
        state.zoom[input.tab] = undefined
      }),
      splitInTab: vi.fn(),
      closeInTab: vi.fn(),
      detachFromTab: vi.fn(),
      resize: vi.fn(),
      swap: vi.fn(),
      clear: vi.fn(),
    },
  }

  return { api, setPanes, state }
}

function createHost(tabId: string) {
  const host = document.createElement("div")
  host.id = getTabHostId(tabId)
  document.body.appendChild(host)
  return host
}

function mount(ui: () => JSX.Element) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  return render(ui, { container: root })
}

describe("terminal split → focus integration", () => {
  test("after split: original terminal container exists inside a 50% width wrapper", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Terminal 1",
      closable: true,
    }
    const host = createHost(tab.id)

    const [allPtys, setAllPtys] = createSignal<Pty[]>([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
    ])
    terminalCtx = {
      all: allPtys,
      active: () => allPtys()[0]?.id,
      new: vi.fn(),
      close: vi.fn(),
      update: vi.fn(),
      clone: vi.fn(),
    }

    const { api, setPanes } = makeReactiveClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      initialPanes: {
        "tab-1": { t: "leaf", id: "pty-1" },
      },
      terminalAll: allPtys,
    })
    claxedo = api

    mount(() => <ClaxedoDirectoryProvider />)

    // Wait for initial terminal to render
    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-1"]')).toBeTruthy()
    })

    // Before split: find the terminal's absolute-positioned wrapper
    const pty1El = host.querySelector('[data-pty="pty-1"]')!
    const wrapperBefore = pty1El.closest(".absolute") as HTMLElement | null

    // The wrapper should have width: 100% (single leaf)
    if (wrapperBefore) {
      expect(wrapperBefore.style.width).toBe("100%")
    }

    // === SPLIT ===
    setAllPtys([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
      { id: "pty-2", title: "Terminal 2", cwd: "/ws" },
    ])
    setPanes({
      "tab-1": {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      },
    })

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-1"]')).toBeTruthy()
      expect(host.querySelector('[data-pty="pty-2"]')).toBeTruthy()
    })

    // After split: the wrapper should have width: 50%
    const pty1AfterEl = host.querySelector('[data-pty="pty-1"]')!
    const wrapperAfter = pty1AfterEl.closest(".absolute") as HTMLElement | null
    expect(wrapperAfter).toBeTruthy()
    expect(wrapperAfter!.style.width).toBe("50%")

    // pty-2 wrapper should also be 50%
    const pty2El = host.querySelector('[data-pty="pty-2"]')!
    const wrapper2 = pty2El.closest(".absolute") as HTMLElement | null
    expect(wrapper2).toBeTruthy()
    expect(wrapper2!.style.width).toBe("50%")
  })

  test("after split: CSS wrapper widths update correctly", async () => {
    // Note: the opencode:terminal-fit event (150ms timer) fires through
    // the attach scheduler path during real splits. This test verifies
    // the CSS layout updates, not the event dispatch (which requires
    // the full detection effect → attach scheduler flow).
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Terminal 1",
      closable: true,
    }
    const host = createHost(tab.id)

    const [allPtys, setAllPtys] = createSignal<Pty[]>([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
    ])
    terminalCtx = {
      all: allPtys,
      active: () => allPtys()[0]?.id,
      new: vi.fn(),
      close: vi.fn(),
      update: vi.fn(),
      clone: vi.fn(),
    }

    const { api, setPanes } = makeReactiveClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      initialPanes: {
        "tab-1": { t: "leaf", id: "pty-1" },
      },
      terminalAll: allPtys,
    })
    claxedo = api

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-1"]')).toBeTruthy()
    })

    // === SPLIT ===
    setAllPtys([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
      { id: "pty-2", title: "Terminal 2", cwd: "/ws" },
    ])
    setPanes({
      "tab-1": {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      },
    })

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-2"]')).toBeTruthy()
    })

    // Both wrappers at 50%
    const pty1El = host.querySelector('[data-pty="pty-1"]')!
    const pty2El = host.querySelector('[data-pty="pty-2"]')!
    expect((pty1El.closest(".absolute") as HTMLElement)?.style.width).toBe("50%")
    expect((pty2El.closest(".absolute") as HTMLElement)?.style.width).toBe("50%")
  })

  test("after split + focus: focusInTab is called for the clicked pane", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Terminal 1",
      closable: true,
    }
    const host = createHost(tab.id)

    const [allPtys, setAllPtys] = createSignal<Pty[]>([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
    ])
    terminalCtx = {
      all: allPtys,
      active: () => allPtys()[0]?.id,
      new: vi.fn(),
      close: vi.fn(),
      update: vi.fn(),
      clone: vi.fn(),
    }

    const { api, setPanes, state } = makeReactiveClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      initialPanes: {
        "tab-1": { t: "leaf", id: "pty-1" },
      },
      terminalAll: allPtys,
    })
    claxedo = api

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-1"]')).toBeTruthy()
    })

    // === SPLIT ===
    setAllPtys([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
      { id: "pty-2", title: "Terminal 2", cwd: "/ws" },
    ])
    setPanes({
      "tab-1": {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      },
    })

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-2"]')).toBeTruthy()
    })

    // Clear previous calls
    api.terminal.focusInTab.mockClear()

    // Find the pty-1 pane container (the [data-pane="pty-1"] element)
    const paneEl = host.querySelector('[data-pane="pty-1"]') as HTMLElement
    expect(paneEl).toBeTruthy()

    // Simulate clicking (focusing) the first pane
    fireEvent.pointerDown(paneEl)

    // focusInTab should have been called with pty-1
    expect(api.terminal.focusInTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pty-1", tab: "tab-1" })
    )
  })

  test("after split + focus, terminal-fit event IS dispatched for the focused pane", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Terminal 1",
      closable: true,
    }
    const host = createHost(tab.id)

    const [allPtys, setAllPtys] = createSignal<Pty[]>([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
    ])
    terminalCtx = {
      all: allPtys,
      active: () => allPtys()[0]?.id,
      new: vi.fn(),
      close: vi.fn(),
      update: vi.fn(),
      clone: vi.fn(),
    }

    const { api, setPanes } = makeReactiveClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      initialPanes: {
        "tab-1": { t: "leaf", id: "pty-1" },
      },
      terminalAll: allPtys,
    })
    claxedo = api

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-1"]')).toBeTruthy()
    })

    // === SPLIT ===
    setAllPtys([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
      { id: "pty-2", title: "Terminal 2", cwd: "/ws" },
    ])
    setPanes({
      "tab-1": {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      },
    })

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-2"]')).toBeTruthy()
    })

    // Wait for the post-split terminal-fit event (150ms timer)
    await new Promise((r) => setTimeout(r, 200))

    // Clear all tracking — now simulate focus
    fitEvents.length = 0

    // Click on the first pane
    const paneEl = host.querySelector('[data-pane="pty-1"]') as HTMLElement
    expect(paneEl).toBeTruthy()
    fireEvent.pointerDown(paneEl)

    // Wait to see if any terminal-fit event fires after focus
    await new Promise((r) => setTimeout(r, 200))

    // When the user clicks on a pane after split, a terminal-fit event
    // MUST be dispatched so the xterm instance can refresh/re-render.
    // The LeafNode's onPointerDown dispatches opencode:terminal-fit
    // after calling focusInTab, triggering the resize coordinator to
    // run fit+refresh and fix any stale WebGL renderer state.
    expect(fitEvents.length).toBeGreaterThanOrEqual(1)
  })

  test("terminal is mounted only once through entire split + focus flow", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Terminal 1",
      closable: true,
    }
    const host = createHost(tab.id)

    const [allPtys, setAllPtys] = createSignal<Pty[]>([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
    ])
    terminalCtx = {
      all: allPtys,
      active: () => allPtys()[0]?.id,
      new: vi.fn(),
      close: vi.fn(),
      update: vi.fn(),
      clone: vi.fn(),
    }

    const { api, setPanes } = makeReactiveClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      initialPanes: {
        "tab-1": { t: "leaf", id: "pty-1" },
      },
      terminalAll: allPtys,
    })
    claxedo = api

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-1"]')).toBeTruthy()
    })

    const mountsBefore = mounts.filter((m) => m.id === "pty-1").length
    expect(mountsBefore).toBe(1)

    // === SPLIT ===
    setAllPtys([
      { id: "pty-1", title: "Terminal 1", cwd: "/ws" },
      { id: "pty-2", title: "Terminal 2", cwd: "/ws" },
    ])
    setPanes({
      "tab-1": {
        t: "split",
        dir: "v",
        a: { t: "leaf", id: "pty-1" },
        b: { t: "leaf", id: "pty-2" },
        size: 0.5,
      },
    })

    await waitFor(() => {
      expect(host.querySelector('[data-pty="pty-2"]')).toBeTruthy()
    })

    // Focus first pane
    const paneEl = host.querySelector('[data-pane="pty-1"]') as HTMLElement
    fireEvent.pointerDown(paneEl)
    await new Promise((r) => setTimeout(r, 50))

    // pty-1 should have been mounted exactly ONCE through the entire flow
    const mountsAfter = mounts.filter((m) => m.id === "pty-1").length
    expect(mountsAfter).toBe(1)

    // pty-2 should have been mounted exactly once
    const pty2Mounts = mounts.filter((m) => m.id === "pty-2").length
    expect(pty2Mounts).toBe(1)
  })
})

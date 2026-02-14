/**
 * Terminal split remount test
 *
 * Verifies that when a terminal pane splits (leaf → split), the EXISTING
 * terminal's DOM element is preserved (not destroyed and recreated).
 *
 * Remounting the Terminal component during a split causes a buffer
 * serialize/restore cycle that garbles text. The fix must ensure the
 * original LeafNode (and its Terminal) stays alive when the pane tree
 * root changes from leaf to split.
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { render, waitFor, cleanup } from "@solidjs/testing-library"
import { type JSX, createSignal } from "solid-js"

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

// Track Terminal mount events per pty ID
const terminalMounts = new Map<string, number>()

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
  Terminal: (props: { pty: Pty }) => {
    const id = props.pty.id
    terminalMounts.set(id, (terminalMounts.get(id) ?? 0) + 1)
    return (
      <div
        data-testid="terminal"
        data-pty={id}
        data-mount-count={terminalMounts.get(id)}
        data-component="terminal"
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
  terminalMounts.clear()
})

function paneIds(node: Pane | undefined): string[] {
  if (!node) return []
  if (node.t === "leaf") return [node.id]
  return [...paneIds(node.a), ...paneIds(node.b)]
}

/**
 * makeClaxedo with REACTIVE pane state — uses createSignal so that
 * when setPanes is called, the component tree re-renders.
 */
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
      // REACTIVE: reads from signal
      pane: (tab: string) => panes()[tab],
      ids: (tab: string) => paneIds(panes()[tab]),
      ensure: (tab: string, id: string) => {
        if (!state.focus[tab]) state.focus[tab] = id
      },
      focus: (tab: string) => state.focus[tab],
      setFocus: (tab: string, id: string) => { state.focus[tab] = id },
      zoom: (tab: string) => state.zoom[tab],
      zoomInTab: vi.fn((input: { tab: string; id: string }) => {
        state.zoom[input.tab] = state.zoom[input.tab] === input.id ? undefined : input.id
      }),
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

  return { api, setPanes }
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

describe("terminal split remount", () => {
  test("existing terminal DOM element is NOT remounted when pane changes from leaf to split", async () => {
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
      const el = host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')
      expect(el).toBeTruthy()
    })

    // Capture the DOM element reference BEFORE split
    const pty1Before = host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')!
    const mountCountBefore = terminalMounts.get("pty-1") ?? 0
    expect(mountCountBefore).toBe(1)

    // Simulate split: add pty-2 to store, change pane from leaf → split
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

    // Wait for split to render — both terminals should be visible
    await waitFor(() => {
      expect(host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
      expect(host.querySelector('[data-testid="terminal"][data-pty="pty-2"]')).toBeTruthy()
    })

    // CRITICAL ASSERTION: the original terminal must be the SAME DOM element.
    // If the Terminal component was remounted, the old element was destroyed
    // and a new one was created — causing buffer serialize/restore which
    // garbles terminal text.
    const pty1After = host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')!
    expect(pty1After).toBe(pty1Before)

    // Also verify mount count: pty-1 should have been mounted exactly once.
    // If it was remounted, the count would be 2.
    const mountCountAfter = terminalMounts.get("pty-1") ?? 0
    expect(mountCountAfter).toBe(1)

    // pty-2 should have been mounted exactly once (new terminal).
    expect(terminalMounts.get("pty-2") ?? 0).toBe(1)
  })
})

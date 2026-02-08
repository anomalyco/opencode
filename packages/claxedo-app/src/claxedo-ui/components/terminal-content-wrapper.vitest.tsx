import { afterEach, describe, expect, test, vi } from "vitest"
import { render, waitFor, cleanup } from "@solidjs/testing-library"
import { type JSX } from "solid-js"

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
  Terminal: (props: { pty: Pty }) => (
    <div data-testid="terminal" data-pty={props.pty.id}>
      {props.pty.title}
    </div>
  ),
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
})

function terminalStore(all: Pty[]) {
  return {
    all: () => all,
    active: () => all[0]?.id,
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
}) {
  const state = {
    focusedId: input.focusedId,
    groups: input.groups,
    pane: { ...input.panes } as Record<string, Pane | undefined>,
    focus: {} as Record<string, string | undefined>,
    zoom: {} as Record<string, string | undefined>,
    owner: {} as Record<string, string | undefined>,
  }

  const ids = (node: Pane | undefined): string[] => {
    if (!node) return []
    if (node.t === "leaf") return [node.id]
    return [...ids(node.a), ...ids(node.b)]
  }

  const g = (id: string) => state.groups.find((x) => x.id === id)

  const topTabs = {
    items: () => g(state.focusedId)?.tabs ?? [],
    active: () => {
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
      hidden: () => false,
    },
    topTabs,
    groupTabs: (id: string) => ({
      items: () => g(id)?.tabs ?? [],
      active: () => (g(id)?.tabs ?? [])[0],
      addTerminal: vi.fn(() => ""),
      close: vi.fn(),
      patch: vi.fn(),
    }),
    findTabGroup: (tabId: string) => state.groups.find((x) => x.tabs.some((t) => t.id === tabId))?.id,
    terminal: {
      pendingCreate: () => 0,
      pendingDir: () => undefined,
      consumePendingCommand: () => ({ command: undefined, title: undefined }),
      clearPendingCreate: vi.fn(),
      creating: () => 0,
      creatingGroupId: () => undefined,
      created: vi.fn(),
      owner: (id: string) => state.owner[id],
      own: (tab: string, id: string) => {
        state.owner[id] = tab
      },
      disown: (id: string) => {
        state.owner[id] = undefined
      },
      pane: (tab: string) => state.pane[tab],
      ids: (tab: string) => ids(state.pane[tab]),
      ensure: (tab: string, id: string) => {
        if (state.pane[tab]) return
        state.pane[tab] = { t: "leaf", id }
        state.focus[tab] = id
      },
      focus: (tab: string) => state.focus[tab],
      setFocus: (tab: string, id: string) => {
        state.focus[tab] = id
      },
      zoom: (tab: string) => state.zoom[tab],
      setZoom: (tab: string, id: string | undefined) => {
        state.zoom[tab] = id
      },
      split: vi.fn(),
      close: vi.fn(),
      path: vi.fn(),
      resize: vi.fn(),
      swap: vi.fn(),
      clear: vi.fn(),
    },
  }
}

function mount(ui: () => JSX.Element) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  return render(ui, { container: root })
}

function createHost(tabId: string) {
  const host = document.createElement("div")
  host.id = getTabHostId(tabId)
  document.body.appendChild(host)
  return host
}

describe("terminal-content-wrapper ui render", () => {
  test("renders active terminal into tab host portal", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    const host = createHost(tab.id)
    terminalCtx = terminalStore([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
    })
  })

  test("shows 'Terminal not found' when tab/pane exist but terminal store is missing pty", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-404",
      title: "Missing",
      closable: true,
    }
    const host = createHost(tab.id)
    terminalCtx = terminalStore([])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-404" } },
    })

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.textContent).toContain("Terminal not found")
    })
  })

  test("route-level instance renders portals for terminal tabs across groups", async () => {
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
    terminalCtx = terminalStore([
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

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host1.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
      expect(host2.querySelector('[data-testid="terminal"][data-pty="pty-2"]')).toBeTruthy()
    })
  })
})

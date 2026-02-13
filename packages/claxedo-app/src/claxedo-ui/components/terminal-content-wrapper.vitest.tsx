import { afterEach, describe, expect, test, vi } from "vitest"
import { render, waitFor, cleanup, fireEvent } from "@solidjs/testing-library"
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
  Terminal: (props: { pty: Pty; onSplitVertical?: () => void; onSplitHorizontal?: () => void }) => (
    <div
      data-testid="terminal"
      data-pty={props.pty.id}
      data-component="terminal"
      tabIndex={0}
      onKeyDown={(event) => {
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
  splitPendingTab?: string
  closingIds?: string[]
  owners?: Record<string, string | undefined>
  lifecycles?: Record<string, "creating" | "attaching" | "attached" | "closing" | "closed" | undefined>
  hidden?: boolean
}) {
  const [hidden, setHidden] = createSignal(!!input.hidden)
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
    splitPendingTab: input.splitPendingTab as string | undefined,
    closing: new Set(input.closingIds ?? []),
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
      hidden,
      _setHidden: setHidden,
      toggle: vi.fn(),
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
      creating: () => input.creating ?? 0,
      creatingGroupId: () => input.creatingGroupId,
      splitPendingTab: () => state.splitPendingTab,
      beginSplit: (tab: string) => {
        state.splitPendingTab = tab
      },
      clearSplitPending: (tab?: string) => {
        if (!tab || state.splitPendingTab === tab) state.splitPendingTab = undefined
      },
      isClosing: (id: string) => state.closing.has(id),
      beginClosing: (id: string) => {
        state.closing.add(id)
      },
      clearClosing: (id: string) => {
        state.closing.delete(id)
      },
      lifecycle: (id: string) => state.lifecycle[id],
      transitionLifecycle: vi.fn(
        (
          id: string,
          next: "creating" | "attaching" | "attached" | "closing" | "closed",
          _reason?: string,
        ) => {
          state.lifecycle[id] = next
          return true
        },
      ),
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
      focusInTab: vi.fn((input: { tab: string; id: string }) => {
        state.focus[input.tab] = input.id
        state.zoom[input.tab] = undefined
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

function findButton(host: HTMLElement, label: string) {
  return [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined
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

  test("group-scoped wrapper stays passive when route-level wrapper is mounted", async () => {
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

    groupId = undefined
    mount(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => {
      expect(host.querySelectorAll('[data-testid="terminal"][data-pty="pty-1"]').length).toBe(1)
    })

    groupId = "g1"
    mount(() => <ClaxedoDirectoryProvider />)
    await waitFor(() => {
      expect(host.querySelectorAll('[data-testid="terminal"][data-pty="pty-1"]').length).toBe(1)
    })
  })

  test("links existing terminal tab should clear creating/loading state", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    createHost(tab.id)
    terminalCtx = terminalStore([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
      creating: 1,
      creatingGroupId: "g1",
    })

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(claxedo.terminal.created).toHaveBeenCalledTimes(1)
    })
  })

  test("split loader should not stay stuck if pending split pty is skipped", async () => {
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
      owners: { "pty-2": "other-tab" },
    })

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
    })

    const splitButton = () => findButton(host, "Split vertical")
    const hasSpinner = () => !!host.querySelector(".animate-spin")

    await waitFor(() => {
      expect(!!splitButton()).toBe(true)
    })

    await fireEvent.click(splitButton()!)

    await waitFor(() => {
      expect(store.new).toHaveBeenCalledTimes(1)
      expect(hasSpinner()).toBe(true)
    })

    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(hasSpinner()).toBe(false)
    })
  })

  test("re-splitting same terminal tab should not create a new terminal tab", async () => {
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

    const tabsApi = claxedo.groupTabs("g1")
    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
    })

    const splitButton = () => findButton(host, "Split vertical")
    expect(!!splitButton()).toBe(true)

    await fireEvent.click(splitButton()!)
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(claxedo.terminal.splitInTab).toHaveBeenCalled()
    })

    claxedo.terminal.close({ tab: "tab-1", id: "pty-2" })
    store.setAll([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])

    await fireEvent.click(splitButton()!)
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-3", title: "Claude 3", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledTimes(2)
      expect(tabsApi.addTerminal).not.toHaveBeenCalled()
    })
  })

  test("Cmd+D on terminal splits current terminal without creating a new tab", async () => {
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

    const tabsApi = claxedo.groupTabs("g1")
    mount(() => <ClaxedoDirectoryProvider />)

    const term = () => host.querySelector('[data-testid="terminal"][data-pty="pty-1"]') as HTMLElement | null

    await waitFor(() => {
      expect(term()).toBeTruthy()
    })

    await fireEvent.keyDown(term()!, { key: "d", metaKey: true })
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(store.new).toHaveBeenCalledTimes(1)
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledTimes(1)
      expect(tabsApi.addTerminal).not.toHaveBeenCalled()
    })
  })

  test("Cmd+D from document with terminal focus splits current terminal without creating a new tab", async () => {
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

    const tabsApi = claxedo.groupTabs("g1")
    mount(() => <ClaxedoDirectoryProvider />)

    const term = () => host.querySelector('[data-testid="terminal"][data-pty="pty-1"]') as HTMLElement | null
    await waitFor(() => {
      expect(term()).toBeTruthy()
    })

    term()!.focus()
    expect(document.activeElement).toBe(term())

    await fireEvent.keyDown(document, { key: "d", metaKey: true })
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(store.new).toHaveBeenCalledTimes(1)
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledTimes(1)
      expect(tabsApi.addTerminal).not.toHaveBeenCalled()
    })
  })

  test("Cmd+D in second group terminal splits second group tab (not first)", async () => {
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
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
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

    mount(() => <ClaxedoDirectoryProvider />)

    const term2 = () => host2.querySelector('[data-testid="terminal"][data-pty="pty-2"]') as HTMLElement | null
    await waitFor(() => {
      expect(host1.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
      expect(term2()).toBeTruthy()
    })

    term2()!.focus()
    expect(document.activeElement).toBe(term2())

    await fireEvent.keyDown(document, { key: "d", metaKey: true })
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
      { id: "pty-3", title: "Claude 3", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledTimes(1)
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledWith({
        tab: "tab-2",
        at: "pty-2",
        id: "pty-3",
        dir: "v",
        origin: { tabId: "tab-2", groupId: "g2", hostId: getTabHostId("tab-2") },
      })
    })
  })

  test("split button in second group terminal header splits second group tab", async () => {
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
    const host2 = createHost(tab2.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
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

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host2.querySelector('[data-testid="terminal"][data-pty="pty-2"]')).toBeTruthy()
    })

    const splitButton = () => findButton(host2, "Split vertical")
    await waitFor(() => {
      expect(!!splitButton()).toBe(true)
    })

    await fireEvent.click(splitButton()!)
    store.setAll([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
      { id: "pty-3", title: "Claude 3", cwd: "/ws" },
    ])

    await waitFor(() => {
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledTimes(1)
      expect(claxedo.terminal.splitInTab).toHaveBeenCalledWith({
        tab: "tab-2",
        at: "pty-2",
        id: "pty-3",
        dir: "v",
        origin: { tabId: "tab-2", groupId: "g2", hostId: getTabHostId("tab-2") },
      })
    })
  })

  test("Cmd+W from terminal focus closes active pane/tab", async () => {
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

    mount(() => <ClaxedoDirectoryProvider />)

    const term = () => host.querySelector('[data-testid="terminal"][data-pty="pty-1"]') as HTMLElement | null
    await waitFor(() => {
      expect(term()).toBeTruthy()
    })

    term()!.focus()
    expect(document.activeElement).toBe(term())

    await fireEvent.keyDown(document, { key: "w", metaKey: true })

    await waitFor(() => {
      expect(store.close).toHaveBeenCalledWith("pty-1")
      expect(claxedo.terminal.closeInTab).toHaveBeenCalledWith({
        tab: "tab-1",
        id: "pty-1",
        origin: { tabId: "tab-1", groupId: "g1", hostId: getTabHostId("tab-1") },
      })
      expect(claxedo.topTabs.close).toHaveBeenCalledWith("tab-1")
    })
  })

  test("Cmd+W closes active terminal tab even when focus is outside terminal", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    createHost(tab.id)
    const outside = document.createElement("button")
    document.body.appendChild(outside)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
    })

    mount(() => <ClaxedoDirectoryProvider />)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    await fireEvent.keyDown(window, { key: "w", metaKey: true })

    await waitFor(() => {
      expect(store.close).toHaveBeenCalledWith("pty-1")
      expect(claxedo.terminal.closeInTab).toHaveBeenCalledWith({
        tab: "tab-1",
        id: "pty-1",
        origin: { tabId: "tab-1", groupId: "g1", hostId: getTabHostId("tab-1") },
      })
      expect(claxedo.topTabs.close).toHaveBeenCalledWith("tab-1")
    })
  })

  test("Cmd+W closes focused child pane in split without closing terminal tab", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    const host = createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
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
    })

    mount(() => <ClaxedoDirectoryProvider />)

    const child = () => host.querySelector('[data-testid="terminal"][data-pty="pty-2"]') as HTMLElement | null
    await waitFor(() => {
      expect(child()).toBeTruthy()
    })

    claxedo.terminal.setFocus("tab-1", "pty-2")
    child()!.focus()
    expect(document.activeElement).toBe(child())

    await fireEvent.keyDown(document, { key: "w", metaKey: true })

    await waitFor(() => {
      expect(store.close).toHaveBeenCalledWith("pty-2")
      expect(claxedo.terminal.closeInTab).toHaveBeenCalledWith({
        tab: "tab-1",
        id: "pty-2",
        origin: { tabId: "tab-1", groupId: "g1", hostId: getTabHostId("tab-1") },
      })
      expect(claxedo.topTabs.close).not.toHaveBeenCalled()
    })
  })

  test("Cmd+W in second group closes second group pane (not first)", async () => {
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
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
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

    mount(() => <ClaxedoDirectoryProvider />)

    const term2 = () => host2.querySelector('[data-testid="terminal"][data-pty="pty-2"]') as HTMLElement | null
    await waitFor(() => {
      expect(host1.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
      expect(term2()).toBeTruthy()
    })

    term2()!.focus()
    expect(document.activeElement).toBe(term2())

    await fireEvent.keyDown(document, { key: "w", metaKey: true })

    await waitFor(() => {
      expect(store.close).toHaveBeenCalledWith("pty-2")
      expect(claxedo.terminal.closeInTab).toHaveBeenCalledWith({
        tab: "tab-2",
        id: "pty-2",
        origin: { tabId: "tab-2", groupId: "g2", hostId: getTabHostId("tab-2") },
      })
    })
  })

  test("does not create a new terminal tab while split attach is pending", async () => {
    const tab: Tab = {
      id: "tab-1",
      type: "terminal",
      directory: "/ws",
      terminalId: "pty-1",
      title: "Claude 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([
      { id: "pty-1", title: "Claude 1", cwd: "/ws" },
      { id: "pty-2", title: "Claude 2", cwd: "/ws" },
    ])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: { "tab-1": { t: "leaf", id: "pty-1" } },
      splitPendingTab: "tab-1",
    })

    const tabsApi = claxedo.groupTabs("g1")
    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(tabsApi.addTerminal).not.toHaveBeenCalled()
      expect(claxedo.terminal.splitInTab).not.toHaveBeenCalled()
    })
  })

  test("does not recreate a terminal tab while terminal close is in flight", async () => {
    const tab: Tab = {
      id: "session-1",
      type: "session",
      directory: "/ws",
      title: "Session 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {},
      closingIds: ["pty-1"],
    })

    const tabsApi = claxedo.groupTabs("g1")
    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(tabsApi.addTerminal).not.toHaveBeenCalled()
    })
  })

  test("does not auto-create terminal tab while PTY lifecycle is attaching", async () => {
    const tab: Tab = {
      id: "session-1",
      type: "session",
      directory: "/ws",
      title: "Session 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {},
      lifecycles: { "pty-1": "attaching" },
    })

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(claxedo.topTabs.addTerminal).not.toHaveBeenCalled()
    })
  })

  test("does not auto-create terminal tab while PTY lifecycle is closing", async () => {
    const tab: Tab = {
      id: "session-1",
      type: "session",
      directory: "/ws",
      title: "Session 1",
      closable: true,
    }
    createHost(tab.id)
    const store = terminalStoreSignal([{ id: "pty-1", title: "Claude 1", cwd: "/ws" }])
    terminalCtx = store
    claxedo = makeClaxedo({
      focusedId: "g1",
      groups: [{ id: "g1", tabs: [tab] }],
      panes: {},
      lifecycles: { "pty-1": "closing" },
    })

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(claxedo.topTabs.addTerminal).not.toHaveBeenCalled()
    })
  })

  test("reactivating terminal host should request fit without manual resize", async () => {
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
    const fit = vi.fn()
    window.addEventListener("opencode:terminal-fit", fit)

    mount(() => <ClaxedoDirectoryProvider />)

    await waitFor(() => {
      expect(host.querySelector('[data-testid="terminal"][data-pty="pty-1"]')).toBeTruthy()
    })

    host.remove()
    document.body.appendChild(host)
    claxedo.split._setHidden(true)
    claxedo.split._setHidden(false)

    await waitFor(() => {
      // Red: currently no fit request is fired when host becomes active again.
      expect(fit).toHaveBeenCalled()
    })

    window.removeEventListener("opencode:terminal-fit", fit)
  })
})

import { createSignal } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { paneFindPath, paneIncludes, paneList, reduceTerminalTab, type TerminalTabAction } from "../terminal-reducer"
import type {
  ClaxedoLayoutStore,
  Pane,
  PaneDir,
  TabItem,
  TerminalActionOrigin,
  TerminalAgentStatus,
  TerminalLifecycleState,
} from "./types"

type TerminalInvariantPayload = {
  origin?: TerminalActionOrigin
  targetTab?: string
  expectedGroupId?: string
  terminalId?: string
  ownerTab?: string
  paneIds?: string[]
  reason?: string
}

type PendingTerminalCreate = {
  directory: string
  command?: string
  title?: string
  groupId?: string
}

export function createTerminalState(input: {
  store: ClaxedoLayoutStore
  setStore: SetStoreFunction<ClaxedoLayoutStore>
  findTabGroup: (tabId: string) => string | undefined
}) {
  const { store, setStore, findTabGroup } = input

  const [pendingTerminalCreate, setPendingTerminalCreate] = createSignal(0)
  const [pendingTerminalCreates, setPendingTerminalCreates] = createSignal<PendingTerminalCreate[]>([])
  const [creatingTerminal, setCreatingTerminal] = createSignal(0)
  const [creatingTerminalGroupId, setCreatingTerminalGroupId] = createSignal<string | undefined>(undefined)
  const [splitPendingTab, setSplitPendingTab] = createSignal<string | undefined>(undefined)
  const [closingTerminalIds, setClosingTerminalIds] = createSignal<string[]>([])

  const firstPendingTerminalCreate = () => pendingTerminalCreates()[0]
  const pendingTerminalCommand = () => firstPendingTerminalCreate()?.command
  const pendingTerminalTitle = () => firstPendingTerminalCreate()?.title
  const pendingTerminalDir = () => firstPendingTerminalCreate()?.directory
  const pendingTerminalGroupId = () => firstPendingTerminalCreate()?.groupId

  const requestTerminalCreate = (dir: string, command?: string, title?: string, groupId?: string) => {
    const debug = typeof localStorage !== "undefined" && localStorage.getItem("opencode.debug.terminal") === "1"
    if (debug) {
      // eslint-disable-next-line no-console
      console.log("[terminal]", "claxedo requestCreate", { dir, command, title, groupId })
    }
    setPendingTerminalCreates((all) => [...all, { directory: dir, command, title, groupId }])
    setPendingTerminalCreate((n) => n + 1)
    setCreatingTerminal((n) => n + 1)
    setCreatingTerminalGroupId(groupId)

    setTimeout(() => {
      setCreatingTerminal((n) => Math.max(0, n - 1))
    }, 5000)
  }

  const clearPendingTerminalCreate = () => {
    setPendingTerminalCreates([])
    setPendingTerminalCreate(0)
  }

  const consumePendingTerminalCommand = () => {
    const all = pendingTerminalCreates()
    const next = all[0]
    if (!next) return { directory: undefined, command: undefined, title: undefined, groupId: undefined }
    const rest = all.slice(1)
    setPendingTerminalCreates(rest)
    setPendingTerminalCreate(rest.length)
    return {
      directory: next.directory,
      command: next.command,
      title: next.title,
      groupId: next.groupId,
    }
  }

  const clearStaleCreatingState = (removedGroupIds: Set<string>) => {
    if (removedGroupIds.has(creatingTerminalGroupId() ?? "")) {
      setCreatingTerminal(0)
      setCreatingTerminalGroupId(undefined)
      setPendingTerminalCreates([])
      setPendingTerminalCreate(0)
    }
  }

  const clearTerminalTabState = (tab: string) => {
    const pane = store.terminalPane[tab]
    const flatten = (node: Pane | undefined): string[] => {
      if (!node) return []
      if (node.t === "leaf") return [node.id]
      return [...flatten(node.a), ...flatten(node.b)]
    }
    const paneIds = flatten(pane)
    const tabTerminal = store.groups.flatMap((g) => g.tabs.items).find((t) => t.id === tab && t.type === "terminal")
    const tabIds = tabTerminal?.terminalId ? [tabTerminal.terminalId] : []
    const owned = Object.entries(store.terminalOwner)
      .filter(([, v]) => v === tab)
      .map(([k]) => k)
    const ids = [...new Set([...paneIds, ...tabIds, ...owned])]

    setStore("terminalFocus", tab, undefined)
    setStore("terminalZoom", tab, undefined)

    for (const id of ids) {
      setStore("terminalOwner", id, undefined)
      setStore("terminalAgentStatus", id, undefined)
      setStore("terminalAgentSeen", id, undefined)
      setStore("terminalLifecycle", id, "closing")
    }
  }

  const terminalActionError = (action: string, payload: TerminalInvariantPayload) => {
    if (!import.meta.env.DEV) return
    // eslint-disable-next-line no-console
    console.error("[terminal:invariant]", {
      action,
      ...payload,
    })
  }

  const terminalLifecycleTransition = {
    creating: new Set<TerminalLifecycleState>(["attaching", "attached", "closing", "closed"]),
    attaching: new Set<TerminalLifecycleState>(["attached", "closing", "closed"]),
    attached: new Set<TerminalLifecycleState>(["closing", "closed"]),
    closing: new Set<TerminalLifecycleState>(["closed"]),
    closed: new Set<TerminalLifecycleState>(["creating"]),
  } satisfies Record<TerminalLifecycleState, Set<TerminalLifecycleState>>

  const transitionTerminalLifecycle = (id: string, next: TerminalLifecycleState, reason?: string) => {
    const current = store.terminalLifecycle[id]
    if (current === next) return true
    const allowed =
      current === undefined
        ? new Set<TerminalLifecycleState>(["creating", "attaching", "attached", "closing", "closed"])
        : terminalLifecycleTransition[current]
    if (allowed.has(next)) {
      setStore("terminalLifecycle", id, next)
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[terminal:lifecycle]", { id, from: current, to: next, reason })
      }
      return true
    }
    terminalActionError("transitionLifecycle", {
      terminalId: id,
      reason: `illegal_transition:${current ?? "undefined"}->${next}${reason ? `:${reason}` : ""}`,
    })
    return false
  }

  const assertTerminalInvariant = (action: string, ok: boolean, payload: TerminalInvariantPayload) => {
    if (ok) return true
    terminalActionError(action, payload)
    return false
  }

  const requireTerminalOrigin = (action: string, tabId: string, origin?: TerminalActionOrigin) => {
    if (store.groups.length <= 1) return true
    if (!assertTerminalInvariant(action, !!origin, { origin, targetTab: tabId, reason: "missing_origin" })) return false
    if (!origin) return false
    if (!assertTerminalInvariant(action, origin.tabId === tabId, { origin, targetTab: tabId, reason: "origin_tab_mismatch" })) return false
    const groupId = findTabGroup(tabId)
    if (!groupId) return true
    if (origin.groupId === groupId) return true
    return assertTerminalInvariant(action, false, {
      origin,
      targetTab: tabId,
      expectedGroupId: groupId,
      reason: "origin_group_mismatch",
    })
  }

  const requireTerminalInTabPane = (action: string, tabId: string, terminalId: string, origin?: TerminalActionOrigin) => {
    const pane = store.terminalPane[tabId]
    const paneIds = paneList(pane)
    return assertTerminalInvariant(action, paneIds.includes(terminalId), {
      origin,
      targetTab: tabId,
      terminalId,
      paneIds,
      reason: "terminal_not_in_target_tab_pane",
    })
  }

  const requireTerminalOwnerMatchesTab = (action: string, tabId: string, terminalId: string, origin?: TerminalActionOrigin) => {
    const ownerTab = store.terminalOwner[terminalId]
    if (!ownerTab) return true
    return assertTerminalInvariant(action, ownerTab === tabId, {
      origin,
      targetTab: tabId,
      terminalId,
      ownerTab,
      reason: "owner_tab_mismatch",
    })
  }

  const reduceTerminalInTab = (tab: string, action: TerminalTabAction) => {
    const current = {
      pane: store.terminalPane[tab],
      focus: store.terminalFocus[tab],
      zoom: store.terminalZoom[tab],
    }
    const next = reduceTerminalTab(current, action)
    if (next.pane !== current.pane) setStore("terminalPane", tab, next.pane)
    if (next.focus !== current.focus) setStore("terminalFocus", tab, next.focus)
    if (next.zoom !== current.zoom) setStore("terminalZoom", tab, next.zoom)
    return next
  }

  const terminal = {
    pendingCreate: pendingTerminalCreate,
    pendingCommand: pendingTerminalCommand,
    pendingDir: pendingTerminalDir,
    pendingGroupId: pendingTerminalGroupId,
    requestCreate: requestTerminalCreate,
    clearPendingCreate: clearPendingTerminalCreate,
    consumePendingCommand: consumePendingTerminalCommand,
    creating: creatingTerminal,
    creatingGroupId: creatingTerminalGroupId,
    splitPendingTab,

    beginSplit(tab: string) {
      setSplitPendingTab(tab)
    },

    clearSplitPending(tab?: string) {
      if (!tab || splitPendingTab() === tab) setSplitPendingTab(undefined)
    },

    isClosing(id: string) {
      return closingTerminalIds().includes(id)
    },

    beginClosing(id: string) {
      transitionTerminalLifecycle(id, "closing", "beginClosing")
      setClosingTerminalIds((all) => (all.includes(id) ? all : [...all, id]))
    },

    clearClosing(id: string) {
      transitionTerminalLifecycle(id, "closed", "clearClosing")
      setClosingTerminalIds((all) => all.filter((item) => item !== id))
    },

    lifecycle(id: string) {
      return store.terminalLifecycle[id]
    },

    transitionLifecycle(id: string, state: TerminalLifecycleState, reason?: string) {
      return transitionTerminalLifecycle(id, state, reason)
    },

    created() {
      setCreatingTerminal((n) => Math.max(0, n - 1))
      if (creatingTerminal() === 0) setCreatingTerminalGroupId(undefined)
    },

    owner(id: string) {
      return store.terminalOwner[id]
    },

    own(tab: string, id: string) {
      setStore("terminalOwner", id, tab)
    },

    disown(id: string) {
      setStore("terminalOwner", id, undefined)
    },

    detachFromTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
      if (!requireTerminalOrigin("detachFromTab", input.tab, input.origin)) return
      if (!requireTerminalOwnerMatchesTab("detachFromTab", input.tab, input.id, input.origin)) return
      if (!requireTerminalInTabPane("detachFromTab", input.tab, input.id, input.origin)) return
      reduceTerminalInTab(input.tab, { type: "detach", id: input.id })
      setStore("terminalOwner", input.id, undefined)
    },

    pane(tab: string) {
      return store.terminalPane[tab]
    },

    ids(tab: string) {
      return paneList(store.terminalPane[tab])
    },

    ensure(tab: string, id: string) {
      reduceTerminalInTab(tab, { type: "ensure", id })
    },

    focus(tab: string) {
      return store.terminalFocus[tab]
    },

    setFocus(tab: string, id: string) {
      reduceTerminalInTab(tab, { type: "set_focus", id })
    },

    focusInTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
      if (!requireTerminalOrigin("focusInTab", input.tab, input.origin)) return
      if (!requireTerminalInTabPane("focusInTab", input.tab, input.id, input.origin)) return
      reduceTerminalInTab(input.tab, { type: "focus", id: input.id })
    },

    zoom(tab: string) {
      return store.terminalZoom[tab]
    },

    setZoom(tab: string, id: string | undefined) {
      reduceTerminalInTab(tab, { type: "set_zoom", id })
    },

    zoomInTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
      if (!requireTerminalOrigin("zoomInTab", input.tab, input.origin)) return
      if (!requireTerminalInTabPane("zoomInTab", input.tab, input.id, input.origin)) return
      reduceTerminalInTab(input.tab, { type: "zoom", id: input.id })
    },

    split(input: { tab: string; at: string; id: string; dir: PaneDir }) {
      reduceTerminalInTab(input.tab, { type: "split", at: input.at, id: input.id, dir: input.dir })
    },

    splitInTab(input: { tab: string; at: string; id: string; dir: PaneDir; origin?: TerminalActionOrigin }) {
      if (!requireTerminalOrigin("splitInTab", input.tab, input.origin)) return
      if (!requireTerminalOwnerMatchesTab("splitInTab", input.tab, input.id, input.origin)) return
      const node = store.terminalPane[input.tab]
      if (
        node &&
        !assertTerminalInvariant("splitInTab", paneIncludes(node, input.at), {
          origin: input.origin,
          targetTab: input.tab,
          terminalId: input.at,
          paneIds: paneList(node),
          reason: "split_target_not_in_tab",
        })
      ) {
        return
      }
      reduceTerminalInTab(input.tab, { type: "split", at: input.at, id: input.id, dir: input.dir })
    },

    close(input: { tab: string; id: string }) {
      reduceTerminalInTab(input.tab, { type: "close", id: input.id })
    },

    closeInTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
      if (!requireTerminalOrigin("closeInTab", input.tab, input.origin)) return
      if (!requireTerminalOwnerMatchesTab("closeInTab", input.tab, input.id, input.origin)) return
      if (!requireTerminalInTabPane("closeInTab", input.tab, input.id, input.origin)) return
      reduceTerminalInTab(input.tab, { type: "close", id: input.id })
    },

    path(input: { tab: string; id: string }) {
      return paneFindPath(store.terminalPane[input.tab], input.id)
    },

    resize(input: { tab: string; path: string; size: number }) {
      reduceTerminalInTab(input.tab, { type: "resize", path: input.path, size: input.size })
    },

    swap(input: { tab: string; a: string; b: string }) {
      reduceTerminalInTab(input.tab, { type: "swap", a: input.a, b: input.b })
    },

    clear(tab: string) {
      clearTerminalTabState(tab)
      setStore("terminalPane", tab, undefined)
    },

    agentStatus(terminalId: string): TerminalAgentStatus {
      return store.terminalAgentStatus[terminalId] ?? "idle"
    },

    setAgentStatus(terminalId: string, status: TerminalAgentStatus) {
      setStore("terminalAgentStatus", terminalId, status === "idle" ? undefined : status)
      if (status !== "idle") {
        setStore("terminalAgentSeen", terminalId, true)
      }
    },

    clearAgentStatus(terminalId: string) {
      setStore("terminalAgentStatus", terminalId, undefined)
    },

    clearSeen(terminalId: string) {
      setStore("terminalAgentSeen", terminalId, undefined)
    },

    getTabAgentStatus(tabId: string): { loading: boolean; attention: boolean; done: boolean } {
      const terminalIds = paneList(store.terminalPane[tabId])

      let tab: TabItem | undefined
      for (const group of store.groups) {
        tab = group.tabs.items.find((t) => t.id === tabId)
        if (tab) break
      }
      if (tab?.terminalId && !terminalIds.includes(tab.terminalId)) {
        terminalIds.push(tab.terminalId)
      }

      let hasWorking = false
      let hasPermission = false
      let hasSeen = false

      for (const id of terminalIds) {
        const status = store.terminalAgentStatus[id]
        if (status === "working") hasWorking = true
        if (status === "permission") hasPermission = true
        if (store.terminalAgentSeen[id]) hasSeen = true
      }

      return {
        loading: hasWorking,
        attention: hasPermission,
        done: hasSeen && !hasWorking && !hasPermission,
      }
    },
  }

  return {
    terminal,
    clearTerminalTabState,
    clearStaleCreatingState,
  }
}

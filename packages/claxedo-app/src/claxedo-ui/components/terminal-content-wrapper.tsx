/**
 * Terminal Content Wrapper
 *
 * This component is registered as a directoryProvider and renders terminal content
 * when a terminal tab is active. It has access to both ClaxedoLayout context (from app level)
 * and TerminalProvider context (from directory level).
 *
 * It also handles terminal creation requests from ClaxedoLayout, which doesn't have
 * direct access to terminal context.
 */

import {
  For,
  Show,
  createMemo,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type ParentProps,
} from "solid-js"
import { Portal } from "solid-js/web"
import { useTerminal } from "@/context/terminal"
import { Terminal } from "@/components/terminal"
import { useClaxedoLayout } from "../context/claxedo-layout"
import { useGroupId } from "../context/group-id"
import { useSDK } from "@/context/sdk"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { getTabHostId } from "./tab-content-area"

export function getEnsureTargets(
  tabs: Array<{ id: string; type: string; terminalId?: string }>,
  _activeTabId: string | undefined,
  getFocus: (tabId: string) => string | undefined,
  getIds: (tabId: string) => string[],
) {
  return tabs.flatMap((tab) => {
    if (tab.type !== "terminal") return []
    const id = tab.terminalId ?? getFocus(tab.id) ?? getIds(tab.id)[0]
    if (!id) return []
    return [{ tabId: tab.id, id }]
  })
}

export function pickVisibleHost(hosts: HTMLElement[]) {
  const visible = hosts.find((host) => {
    if (!host.isConnected) return false
    if (host.hidden) return false
    const style = getComputedStyle(host)
    if (style.display === "none" || style.visibility === "hidden") return false
    if (host.getClientRects().length > 0) return true
    if (style.display !== "none" && style.visibility !== "hidden") return true
    return false
  })
  return visible ?? hosts[0]
}

export function nextPortalHost(current: HTMLElement | null, hosts: HTMLElement[]) {
  const next = pickVisibleHost(hosts)
  if (next) return next
  if (current?.isConnected) return current
  return null
}

export function resolvePortalRender<T>(paneRoot: T | undefined, host: HTMLElement | null) {
  if (!paneRoot) return
  if (!host) return
  return { paneRoot, host }
}

export function paneLeafIds(pane: import("../context/claxedo-layout").Pane): string[] {
  if (pane.t === "leaf") return [pane.id]
  return [...paneLeafIds(pane.a), ...paneLeafIds(pane.b)]
}

export function paneInStore(
  pane: import("../context/claxedo-layout").Pane | undefined,
  has: (id: string) => boolean,
) {
  if (!pane) return false
  const ids = paneLeafIds(pane)
  if (ids.length === 0) return false
  return ids.every(has)
}

export function pickPendingSplitTarget(
  known: ReadonlySet<string> | undefined,
  all: Array<{ id: string }>,
) {
  if (!known) return
  return all.find((pty) => !known.has(pty.id))
}

/**
 * Inner wrapper that has access to both contexts.
 * Split out to ensure hooks are called unconditionally.
 */
function TerminalContentWrapperInner(props: ParentProps & { claxedo: ReturnType<typeof useClaxedoLayout> }) {
  const { claxedo } = props
  const sdk = useSDK()
  const terminal = useTerminal()

  // Use group-specific tabs when inside a GroupIdProvider (split panels),
  // falling back to topTabs for the route-level instance (hidden div mount).
  const groupId = useGroupId()
  const ownTabs = groupId ? claxedo.groupTabs(groupId) : claxedo.topTabs

  // Track which terminals have corresponding tabs in current workspace
  // This Set persists across re-renders but is scoped to this component instance
  const terminalsWithTabs = new Map<string, string>()
  const link = (terminalId: string, tabId: string) => {
    for (const [id, tab] of terminalsWithTabs.entries()) {
      if (tab !== tabId) continue
      if (id === terminalId) return
      terminalsWithTabs.delete(id)
    }
    terminalsWithTabs.set(terminalId, tabId)
  }

  const dir = createMemo(() => sdk.directory)

  const debugLevel = () => {
    if (typeof localStorage === "undefined") return 0
    const raw = localStorage.getItem("opencode.debug.terminal")
    if (!raw) return 0
    if (raw === "true") return 1
    if (raw === "false") return 0
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    return n
  }
  const debug = () => debugLevel() >= 1
  const verbose = () => debugLevel() >= 2

  const log = (...args: unknown[]) => {
    if (!debug()) return
    // eslint-disable-next-line no-console
    console.log("[terminal]", ...args)
  }
  const vlog = (...args: unknown[]) => {
    if (!verbose()) return
    // eslint-disable-next-line no-console
    console.log("[terminal:verbose]", ...args)
  }

  // When directory changes (workspace switch), reset local tracking and re-sync.
  createEffect(
    on(
      () => dir(),
      () => {
        terminalsWithTabs.clear()
        const tabs = ownTabs.items().filter((t) => t.directory === dir())
        const currentTerminalIds = new Set(terminal.all().map((t) => t.id))
        vlog("dir resync", {
          dir: dir(),
          groupId,
          tabs: tabs.map((t) => ({ id: t.id, type: t.type, terminalId: t.type === "terminal" ? t.terminalId : undefined })),
          terminalIds: [...currentTerminalIds],
        })

        // For each terminal tab in current workspace
        for (const tab of tabs) {
          if (tab.type !== "terminal" || !tab.terminalId) continue
          if (currentTerminalIds.has(tab.terminalId)) {
            link(tab.terminalId, tab.id)
            continue
          }
          // Only close orphaned tabs if this instance's terminal store confirms
          // the PTY doesn't exist. On dir change all stores reload from the same
          // localStorage, so they should agree. Link anyway so the detection
          // effect can reconcile later if needed.
        }
      },
    ),
  )

  // Watch for terminal creation requests from ClaxedoLayout.
  // ONLY the route-level instance (groupId=undefined) handles pending creates.
  // Group-scoped instances must NOT consume pending creates to avoid the
  // double-consumption bug: both the target group AND route-level would fire,
  // the first gets the command/title, the second gets undefined and creates
  // a spurious plain terminal.
  createEffect(() => {
    if (groupId) return // Only route-level instance handles pending creates

    const pending = claxedo.terminal.pendingCreate()
    const d = dir()
    if (!pending) return
    if (claxedo.terminal.pendingDir() !== d) return

    const debug = typeof localStorage !== "undefined" && localStorage.getItem("opencode.debug.terminal") === "1"
    if (debug) {
      // eslint-disable-next-line no-console
      console.log("[terminal]", "claxedo pendingCreate seen", { dir: d, groupId })
    }

    // Consume the pending command and title before clearing
    const { command, title } = claxedo.terminal.consumePendingCommand()
    claxedo.terminal.clearPendingCreate()

    // Create terminal - the tab will be added by the detection effect below,
    // which uses creatingGroupId() to route it to the correct group's tabs.
    if (debug) {
      // eslint-disable-next-line no-console
      console.log("[terminal]", "claxedo calling terminal.new()", { command, title })
    }
    terminal.new(command, title)
  })

  const [pane, setPane] = createSignal<
    | {
      tab: string
      root: string
      at: string
      dir: "h" | "v"
      known: ReadonlySet<string>
    }
  | undefined
>()

  const [move, setMove] = createSignal<{ tab: string; id: string } | undefined>()
  const [over, setOver] = createSignal<string | undefined>()

  onMount(() => {
    const handleMove = (event: PointerEvent) => {
      const m = move()
      if (!m) return
      const elt = document.elementFromPoint(event.clientX, event.clientY)
      if (!(elt instanceof HTMLElement)) {
        setOver(undefined)
        return
      }
      const pane = elt.closest("[data-pane]")
      if (!(pane instanceof HTMLElement)) {
        setOver(undefined)
        return
      }
      const id = pane.dataset.pane
      if (!id || id === m.id) {
        setOver(undefined)
        return
      }
      setOver(id)
    }

    const handleUp = () => {
      const m = move()
      const id = over()
      if (m && id) claxedo.terminal.swap({ tab: m.tab, a: m.id, b: id })
      setMove(undefined)
      setOver(undefined)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    onCleanup(() => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    })
  })

  // Watch for new terminals and add tabs for them
  createEffect(() => {
    const d = dir()
    const tabs = ownTabs.items().filter((t) => t.directory === d)
    const byTerminal = new Map<string, string>()
    for (const tab of tabs) {
      if (tab.type !== "terminal" || !tab.terminalId) continue
      byTerminal.set(tab.terminalId, tab.id)
    }
    const all = terminal.all()
    const pendingTarget = pickPendingSplitTarget(pane()?.known, all)
    vlog("detection snapshot", {
      dir: d,
      groupId,
      tabs: tabs.map((t) => ({ id: t.id, type: t.type, terminalId: t.type === "terminal" ? t.terminalId : undefined })),
      all: all.map((t) => ({ id: t.id, title: t.title, cwd: t.cwd })),
      owners: all.map((t) => ({ id: t.id, owner: claxedo.terminal.owner(t.id) })),
      creating: claxedo.terminal.creating(),
      creatingGroupId: claxedo.terminal.creatingGroupId(),
    })

    log("detection effect", {
      dir: d,
      allCount: all.length,
      tabCount: tabs.length,
      byTerminalSize: byTerminal.size,
      trackedSize: terminalsWithTabs.size,
    })

    for (const [i, pty] of all.entries()) {
      const owned = claxedo.terminal.owner(pty.id)
      if (owned) {
        log("skip owned", { id: pty.id, owner: owned })
        continue
      }

      const tabId = byTerminal.get(pty.id)
      if (tabId) {
        link(pty.id, tabId)
        log("linked existing", { id: pty.id, tabId })
        continue
      }

      // If we already tracked this terminal for a now-closed tab, don't recreate it.
      // The close effect below will kill it and clear tracking.
      if (terminalsWithTabs.has(pty.id)) {
        log("skip tracked", { id: pty.id, trackedTab: terminalsWithTabs.get(pty.id) })
        continue
      }

      const req = pane()
      if (req && pendingTarget?.id === pty.id) {
        log("pane attach", { tab: req.tab, at: req.at, dir: req.dir, id: pty.id })
        claxedo.terminal.ensure(req.tab, req.root)
        link(pty.id, req.tab)
        claxedo.terminal.own(req.tab, pty.id)
        claxedo.terminal.split({ tab: req.tab, at: req.at, id: pty.id, dir: req.dir })
        setPane(undefined)
        continue
      }

      // If a group-scoped create is in flight and this is a DIFFERENT group's
      // instance, let the target group (or route-level fallback) handle it.
      // Route-level instances (groupId=undefined) are allowed through so they
      // can act as fallback when the target group has no detection instance.
      const activeCreateGroup = claxedo.terminal.creatingGroupId()
      if (
        claxedo.terminal.creating() > 0 &&
        activeCreateGroup &&
        groupId !== undefined &&
        activeCreateGroup !== groupId
      ) {
        log("skip: create in flight for group", { id: pty.id, targetGroup: activeCreateGroup })
        continue
      }

      // Check if another group already has a tab for this terminal.
      // Use untrack to avoid adding reactive dependencies on all groups' items.
      const inOtherGroup = untrack(() =>
        claxedo.split.groups().some((g) => {
          if (g.id === groupId) return false
          return claxedo
            .groupTabs(g.id)
            .items()
            .some((t) => t.type === "terminal" && t.terminalId === pty.id && t.directory === d)
        }),
      )
      if (inOtherGroup) {
        log("skip: tab exists in other group", { id: pty.id })
        continue
      }

      // New terminal detected (or tab state got wiped) - add a tab for it.
      // Use creatingGroupId if a group-scoped create is in flight (set by requestCreate),
      // otherwise default to own group's tabs.
      const targetGid = claxedo.terminal.creating() > 0 ? claxedo.terminal.creatingGroupId() : undefined
      const targetTabs = targetGid ? claxedo.groupTabs(targetGid) : ownTabs
      log("addTerminal", { dir: d, id: pty.id, title: pty.title, targetGroup: targetGid, ownGroup: groupId })
      const created = targetTabs.addTerminal(d, pty.id, pty.title)
      log("addTerminal result", { created })
      if (!created) continue
      link(pty.id, created)
      claxedo.terminal.created()
    }
  })

  // Watch for closed tabs and kill corresponding terminals
  createEffect(() => {
    const tabs = ownTabs.items().filter((t) => t.directory === dir())
    const currentTerminalIds = new Set(terminal.all().map((t) => t.id))

    for (const [terminalId, tabId] of terminalsWithTabs.entries()) {
      // Check own group first, then fall back to checking all groups.
      // The tab may be in a different group if created via cross-group requestCreate.
      const hasTab =
        tabs.some((t) => t.type === "terminal" && t.terminalId === terminalId) || !!claxedo.findTabGroup(tabId)
      const terminalExists = currentTerminalIds.has(terminalId)

      if (!hasTab && terminalExists) {
        // Tab was closed but terminal still alive - kill it
        // Close terminals synchronously to prevent onCleanup from saving stale buffers
        const ids = claxedo.terminal.ids(tabId)
        void terminal.close(terminalId)
        for (const id of ids) {
          if (id === terminalId) continue
          if (!currentTerminalIds.has(id)) continue
          void terminal.close(id)
        }
        claxedo.terminal.clear(tabId)
        terminalsWithTabs.delete(terminalId)
      } else if (!terminalExists) {
        // Terminal was killed externally - clean up tracking
        terminalsWithTabs.delete(terminalId)
      }
    }
  })

  // If a pty disappears (exited, server restart, etc), close its tab to avoid an empty view.
  // Guard: only act on terminals this instance has tracked. Multiple TerminalContentWrapperInner
  // instances exist (route-level + per-session-tab via DirectoryScope), each with its own
  // TerminalProvider store. Without this guard, a session-tab instance would close tabs for
  // terminals that only exist in the route-level store, causing newly-created tabs to vanish.
  createEffect(() => {
    const tabs = ownTabs.items().filter((t) => t.directory === dir())
    const ids = new Set(terminal.all().map((t) => t.id))

    for (const tab of tabs) {
      const id = tab.type === "terminal" ? tab.terminalId : undefined
      if (!id) continue
      if (ids.has(id)) continue

      // Only act on terminals this instance has tracked via link().
      // Other wrapper instances manage their own terminals.
      if (!terminalsWithTabs.has(id)) continue

      const next = claxedo.terminal.ids(tab.id).find((x) => ids.has(x))
      if (next) {
        log("terminal promote", { from: id, to: next })
        claxedo.terminal.close({ tab: tab.id, id })
        const title = terminal.all().find((pty) => pty.id === next)?.title
        ownTabs.patch(tab.id, { terminalId: next, title: title ?? tab.title })
        claxedo.terminal.setFocus(tab.id, next)
        claxedo.terminal.disown(next)
        link(next, tab.id)
        continue
      }

      terminalsWithTabs.delete(id)
      ownTabs.close(tab.id)
    }
  })

  // Cleanup on unmount - just clear local tracking.
  onCleanup(() => {
    terminalsWithTabs.clear()
  })

  const activeTab = createMemo(() => {
    const tab = ownTabs.active()
    if (debug()) console.log("[terminal] activeTab changed:", tab?.id, tab?.type)
    vlog("active tab detail", tab)
    return tab
  })
  const activeTerminalTabId = createMemo(() => {
    const tab = activeTab()
    if (!tab?.id) return
    if (tab.type !== "terminal") return
    return tab.id
  })
  const activeTerminalId = createMemo(() => {
    const tab = activeTab()
    if (tab?.type !== "terminal") return
    if (tab.terminalId) return tab.terminalId
    const tabId = tab.id
    if (!tabId) return
    const focus = claxedo.terminal.focus(tabId)
    if (focus) return focus
    const ids = claxedo.terminal.ids(tabId)
    const first = ids[0]
    if (first) return first
    const active = terminal.active()
    if (active) return active
    return terminal.all()[0]?.id
  })
  const isTerminalActive = createMemo(() => !!activeTerminalTabId())

  const [host, setHost] = createSignal<HTMLElement | null>(null)

  createEffect(() => {
    const tab = activeTerminalTabId()
    if (!tab) {
      setHost(null)
      return
    }

    const id = getTabHostId(tab)
    if (typeof document === "undefined") return

    const state = { alive: true, raf: 0 }
    const tick = () => {
      if (!state.alive) return
      const elt = document.getElementById(id)
      if (elt) {
        setHost(elt)
        return
      }
      state.raf = requestAnimationFrame(tick)
    }

    // Don't set host to null immediately - keep the old host until new one is found
    // This prevents the portal from unmounting when switching between tabs
    tick()

    onCleanup(() => {
      state.alive = false
      cancelAnimationFrame(state.raf)
    })
  })

  createEffect(() => {
    const targets = getEnsureTargets(
      terminalTabs(),
      activeTerminalTabId(),
      (tabId) => claxedo.terminal.focus(tabId),
      (tabId) => claxedo.terminal.ids(tabId),
    )
    vlog("ensure targets", {
      groupId,
      targets,
      terminalTabs: terminalTabs().map((t) => ({ id: t.id, terminalId: t.terminalId })),
    })
    for (const item of targets) claxedo.terminal.ensure(item.tabId, item.id)
  })

  // Backfill missing terminalId on existing persisted tabs.
  // Without this, terminal tabs can become "blank" (no root id -> no pane -> no portal mount).
  createEffect(() => {
    const tab = activeTab()
    if (tab?.type !== "terminal") return
    if (tab.terminalId) return
    const id = activeTerminalId()
    if (!id) return
    ownTabs.patch(tab.id, { terminalId: id })
    link(id, tab.id)
  })

  const map = createMemo(() => {
    const m = new Map<string, ReturnType<typeof terminal.all>[number]>()
    for (const pty of terminal.all()) {
      m.set(pty.id, pty)
    }
    return m
  })

  const split = (dir: "h" | "v", at: string) => {
    const tab = activeTerminalTabId()
    const root = activeTerminalId()
    if (!tab || !root) return
    const ids = claxedo.terminal.ids(tab)
    const target = ids.includes(at) ? at : (ids[0] ?? at)
    setPane({ tab, root, at: target, dir, known: new Set(terminal.all().map((pty) => pty.id)) })
    terminal.new()
  }

  const close = (id: string) => {
    const tab = activeTerminalTabId()
    const root = activeTerminalId()
    if (!tab || !root) return

    // Close terminal FIRST to remove from store before component unmounts
    // This prevents onCleanup from saving stale buffer data
    void terminal.close(id)

    if (id === root) {
      const next = claxedo.terminal.ids(tab).find((x) => x !== id)
      if (next) {
        const title = map().get(next)?.title
        ownTabs.patch(tab, { terminalId: next, title: title ?? "Terminal" })
        link(next, tab)
        claxedo.terminal.disown(next)
        claxedo.terminal.close({ tab, id })
        claxedo.terminal.setFocus(tab, next)
        return
      }
      claxedo.terminal.close({ tab, id })
      claxedo.terminal.disown(id)
      claxedo.terminal.clear(tab)
      ownTabs.close(tab)
      return
    }

    claxedo.terminal.close({ tab, id })
    claxedo.terminal.disown(id)
  }

  // Intercept Cmd+W while the terminal has focus:
  // - Prevents claxedo's global "Close Tab" command from firing
  // - Closes the focused pane (or the whole terminal tab when it's the last pane)
  onMount(() => {
    const handle = (event: KeyboardEvent) => {
      if (!isTerminalActive()) return
      if (!event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== "w") return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('[data-component="terminal"]')) return
      event.preventDefault()
      event.stopPropagation()

      const tab = activeTerminalTabId()
      if (!tab) return
      const id = claxedo.terminal.focus(tab) ?? activeTerminalId()
      if (!id) return
      close(id)
    }

    document.addEventListener("keydown", handle, true)
    onCleanup(() => document.removeEventListener("keydown", handle, true))
  })

  const detach = (id: string) => {
    const tab = activeTerminalTabId()
    if (!tab) return
    const pty = map().get(id)
    if (!pty) return
    claxedo.terminal.close({ tab, id })
    claxedo.terminal.disown(id)
    const created = ownTabs.addTerminal(dir(), id, pty.title)
    if (created) link(id, created)
  }

  const focus = (id: string) => {
    const tab = activeTerminalTabId()
    if (!tab) return
    claxedo.terminal.setFocus(tab, id)
    claxedo.terminal.setZoom(tab, undefined)
  }

  const zoom = (id: string) => {
    const tab = activeTerminalTabId()
    if (!tab) return
    const current = claxedo.terminal.zoom(tab)
    if (current === id) {
      claxedo.terminal.setZoom(tab, undefined)
      return
    }
    claxedo.terminal.setZoom(tab, id)
  }

  const LeafNode = (props: { id: string }) => {
    const tab = activeTerminalTabId()
    const root = activeTerminalId()
    const zoomed = tab ? claxedo.terminal.zoom(tab) : undefined
    if (zoomed && zoomed !== props.id) return <div class="hidden" />

    const pty = () => {
      const result = map().get(props.id)
      if (debug()) {
        console.log("[terminal] LeafNode pty()", { id: props.id, found: !!result, mapSize: map().size })
      }
      return result
    }
    const active = () => (tab ? claxedo.terminal.focus(tab) : undefined) === props.id
    const dim = () => (zoomed ? 1 : active() ? 1 : 0.7)
    const pendingDir = () => {
      const req = pane()
      if (!req || !tab) return undefined
      // Only show loading on the specific pane being split, not all panes
      if (req.at !== props.id) return undefined
      return req.dir
    }
    const pending = () => pendingDir() !== undefined
    const pendingV = () => pendingDir() === "v"
    const pendingH = () => pendingDir() === "h"

    const startMove = (event: PointerEvent) => {
      if (!tab) return
      event.preventDefault()
      event.stopPropagation()
      setMove({ tab, id: props.id })
    }

    return (
      <div
        data-pane={props.id}
        class="group relative size-full min-w-0 min-h-0 overflow-hidden bg-background-base flex flex-col"
        classList={{
          "ring-1 ring-border-weak-base": over() === props.id,
          "opacity-70": move()?.id === props.id,
        }}
        style={{ opacity: String(dim()) }}
        onPointerDown={() => focus(props.id)}
      >
        <div class="shrink-0 h-8 flex items-center gap-2 px-2 border-b border-border-weak-base bg-background-stronger/60 backdrop-blur select-none">
          <div
            class="flex items-center cursor-grab active:cursor-grabbing"
            onPointerDown={startMove}
            aria-label="Move pane"
          >
            <Icon name="selector" size="small" class="text-icon-weak" />
          </div>

          <div class="flex items-center gap-2 min-w-0 flex-1">
            <span class="text-[12px] font-medium text-text-weak whitespace-nowrap overflow-hidden text-ellipsis">
              {pty()?.title ?? "Terminal"}
            </span>
          </div>

          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <div class="relative">
              <IconButton
                icon="layout-right"
                variant="ghost"
                onClick={() => split("v", props.id)}
                aria-label="Split vertical"
                disabled={pendingV()}
                classList={{ "opacity-50": pendingV() }}
              />
              <Show when={pendingV()}>
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div class="size-3 rounded-full border-2 border-icon-weak border-t-transparent animate-spin" />
                </div>
              </Show>
            </div>
            <div class="relative">
              <IconButton
                icon="layout-bottom"
                variant="ghost"
                onClick={() => split("h", props.id)}
                aria-label="Split horizontal"
                disabled={pendingH()}
                classList={{ "opacity-50": pendingH() }}
              />
              <Show when={pendingH()}>
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div class="size-3 rounded-full border-2 border-icon-weak border-t-transparent animate-spin" />
                </div>
              </Show>
            </div>
            <IconButton icon="expand" variant="ghost" onClick={() => zoom(props.id)} aria-label="Zoom" />
            <Show when={root && props.id !== root}>
              <IconButton
                icon="arrow-right"
                variant="ghost"
                onClick={() => detach(props.id)}
                aria-label="Move to tab"
              />
            </Show>
            <IconButton icon="close-small" variant="ghost" onClick={() => close(props.id)} aria-label="Close pane" />
          </div>
        </div>

        <Show
          when={pty()}
          fallback={
            <div class="flex-1 min-h-0 flex items-center justify-center text-text-weak">
              <div class="flex items-center gap-2">
                <Icon name="console" size="small" />
                <span>Terminal not found</span>
              </div>
            </div>
          }
        >
          {(p) => {
            // Capture pty value at render time to avoid stale accessor access
            const currentPty = p()
            if (debug()) {
              console.log("[terminal] Rendering Terminal component", { id: props.id, ptyId: currentPty.id })
            }
            return (
              <div class="flex-1 min-h-0 h-full w-full overflow-hidden">
                <Terminal
                  pty={currentPty}
                  onCleanup={(pty) => queueMicrotask(() => terminal.update(pty))}
                  onUpdate={terminal.update}
                  // Cmd+D: split left/right (vertical split)
                  onSplitVertical={() => split("v", props.id)}
                  // Cmd+Shift+D: split top/bottom (horizontal split)
                  onSplitHorizontal={() => split("h", props.id)}
                />
              </div>
            )
          }}
        </Show>
      </div>
    )
  }

  const SplitNode = (props: {
    node: Extract<import("../context/claxedo-layout").Pane, { t: "split" }>
    path: string
  }) => {
    const row = () => props.node.dir === "v"
    const size = () => props.node.size
    const [drag, setDrag] = createSignal<
      | {
          tab: string
          path: string
          dir: "h" | "v"
          start: number
          size: number
          rect: DOMRect
        }
      | undefined
    >()

    onMount(() => {
      const move = (event: PointerEvent) => {
        const d = drag()
        if (!d) return
        const delta = (d.dir === "v" ? event.clientX : event.clientY) - d.start
        const span = d.dir === "v" ? d.rect.width : d.rect.height
        if (!span) return
        const next = d.size + delta / span
        claxedo.terminal.resize({ tab: d.tab, path: d.path, size: next })
      }

      const up = () => setDrag(undefined)

      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
      onCleanup(() => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
      })
    })

    const handle = (event: PointerEvent) => {
      const tab = activeTerminalTabId()
      if (!tab) return
      const elt = event.currentTarget
      if (!(elt instanceof HTMLElement)) return
      const rect = elt.parentElement?.getBoundingClientRect()
      if (!rect) return
      const start = row() ? event.clientX : event.clientY
      setDrag({ tab, path: props.path, dir: props.node.dir, start, size: size(), rect })
    }

    return (
      <div
        class="flex size-full min-w-0 min-h-0 gap-[1px]"
        style={{
          "flex-direction": row() ? "row" : "column",
          background: "rgba(255,255,255,0.1)",
        }}
      >
        <div class="min-w-0 min-h-0" style={{ flex: `0 0 ${size() * 100}%` }}>
          <Node node={props.node.a} path={props.path + "a"} />
        </div>
        <div
          class="shrink-0 bg-transparent"
          style={{
            width: row() ? "6px" : "100%",
            height: row() ? "100%" : "6px",
            cursor: row() ? "col-resize" : "row-resize",
          }}
          onPointerDown={handle}
        />
        <div class="min-w-0 min-h-0 flex-1">
          <Node node={props.node.b} path={props.path + "b"} />
        </div>
      </div>
    )
  }

  const Node = (props: { node: import("../context/claxedo-layout").Pane; path: string }) => (
    <Show
      when={props.node.t === "leaf" ? props.node.id : undefined}
      keyed
      fallback={
        <SplitNode
          node={props.node as Extract<import("../context/claxedo-layout").Pane, { t: "split" }>}
          path={props.path}
        />
      }
    >
      {(id) => <LeafNode id={id} />}
    </Show>
  )

  const root = createMemo(() => {
    const tab = activeTerminalTabId()
    if (debug())
      console.log("[terminal] root computation, tab:", tab, "pane:", tab ? claxedo.terminal.pane(tab) : undefined)
    if (!tab) return
    return claxedo.terminal.pane(tab)
  })

  // Only render the Portal if the root terminal exists in THIS instance's store.
  // Multiple TerminalContentWrapperInner instances exist (route-level + per-session-tab),
  // each with separate TerminalProvider stores. Without this guard, instances whose store
  // doesn't include the PTY would render a "Terminal not found" overlay on top of the
  // working terminal from the instance that actually created the PTY.
  const rootInStore = createMemo(() => {
    const id = activeTerminalId()
    if (!id) {
      if (debug()) console.log("[terminal] rootInStore: no activeTerminalId")
      return false
    }
    const hasIt = map().has(id)
    if (debug()) console.log("[terminal] rootInStore", { id, hasIt, mapSize: map().size })
    return hasIt
  })

  // Get all terminal tabs (not just active) so we can render portals for each.
  // Route-level wrapper must aggregate across split groups because topTabs only
  // reflects the focused group.
  const terminalTabs = createMemo(() => {
    const tabs = groupId
      ? ownTabs.items()
      : claxedo
          .split
          .groups()
          .flatMap((g) => claxedo.groupTabs(g.id).items())

    const seen = new Set<string>()
    return tabs.filter((t) => {
      if (t.type !== "terminal" || !t.id) return false
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
  })
  createEffect(() => {
    const tabs = terminalTabs()
    vlog("terminalTabs changed", {
      groupId,
      count: tabs.length,
      tabs: tabs.map((t) => ({ id: t.id, terminalId: t.terminalId, dir: t.directory })),
    })
  })

  // Component to render a portal for a single terminal tab
  const TerminalPortal = (props: { tabId: string }) => {
    const [host, setHost] = createSignal<HTMLElement | null>(null)
    const tabHostId = getTabHostId(props.tabId)

    createEffect(() => {
      // Re-run host resolution when split hide/show changes.
      claxedo.split.hidden()
      const state = { alive: true, raf: 0 }
      const tick = () => {
        if (!state.alive) return
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(`#${CSS.escape(tabHostId)}`))
        const elt = nextPortalHost(host(), candidates)
        if (elt) {
          vlog("portal host attached", { tabId: props.tabId, tabHostId })
          setHost(elt)
          return
        }
        vlog("portal host missing", { tabId: props.tabId, tabHostId })
        state.raf = requestAnimationFrame(tick)
      }
      tick()
      onCleanup(() => {
        state.alive = false
        cancelAnimationFrame(state.raf)
      })
    })

    const paneRoot = createMemo(() => claxedo.terminal.pane(props.tabId))
    createEffect(() => {
      vlog("portal pane snapshot", {
        tabId: props.tabId,
        hasHost: !!host(),
        paneRoot: paneRoot(),
        ids: claxedo.terminal.ids(props.tabId),
        focus: claxedo.terminal.focus(props.tabId),
        zoom: claxedo.terminal.zoom(props.tabId),
        mapIds: [...map().keys()],
      })
    })

    const renderState = createMemo(() => {
      const pane = paneRoot()
      if (!paneInStore(pane, (id) => map().has(id))) return
      return resolvePortalRender(pane, host())
    })
    return (
      <Show when={renderState()} keyed>
        {(state) => {
          if (debug())
            console.log("[terminal] Portal rendering for tab:", props.tabId, "host:", tabHostId, "found:", !!state.host)
          if (!state.host) return null
          return (
            <Portal mount={state.host}>
              <div class="absolute inset-0 overflow-hidden bg-background-base">
                <Node node={state.paneRoot as import("../context/claxedo-layout").Pane} path="" />
              </div>
            </Portal>
          )
        }}
      </Show>
    )
  }

  return (
    <>
      {props.children}
      {/* Render a portal for EACH terminal tab, not just the active one.
          This ensures terminals stay rendered when switching panel focus. */}
      <For each={terminalTabs()}>{(tab) => <TerminalPortal tabId={tab.id} />}</For>
    </>
  )
}

/**
 * DirectoryProvider that renders terminal content when a terminal tab is active.
 *
 * This is registered as a directoryProvider, so it:
 * - Has access to SDKProvider (from DirectoryLayout)
 * - Has access to ClaxedoLayoutProvider (from app level, since it wraps routes)
 *
 * Terminal context is provided by DirectoryLayout (workspace scope).
 */
export function ClaxedoDirectoryProvider(props: ParentProps) {
  // Try to get claxedo context - may not be available if not using Claxedo layout
  let claxedo: ReturnType<typeof useClaxedoLayout> | null = null
  try {
    claxedo = useClaxedoLayout()
  } catch {
    // ClaxedoLayout not active, just pass through children with TerminalProvider only
    console.warn("[claxedo] ClaxedoLayoutProvider missing; terminal tabs will not render.")
  }

  if (!claxedo) return <>{props.children}</>

  return <TerminalContentWrapperInner claxedo={claxedo}>{props.children}</TerminalContentWrapperInner>
}

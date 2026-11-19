import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { displayName } from "@opencode/ui/project-avatar"
import { uuid } from "@opencode/util/uuid"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettings } from "@/settings/model"
import { tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import {
  applyVerticalDragCommit,
  INITIAL_VERTICAL_DRAG_STATE,
  selectCombineOfTab,
  selectDraggedLaneShift,
  selectDraggedOffsetY,
  selectDraggingGroupKey,
  selectDraggingTabKey,
  selectDropInsideGroupKey,
  selectGroupRailAdjustment,
  selectGroupShiftY,
  selectHeaderShiftY,
  selectIsDraggingStrip,
  selectJoinGroupKey,
  selectNeedsDragMeasurement,
  selectTabShiftY,
  transitionVerticalDrag,
  type MeasuredStripRow,
  type MeasuredTopBlock,
  type VerticalDragEvent,
  type VerticalDragGeometry,
  type VerticalDragIntent,
  type VerticalDragSource,
} from "./tab-group-drag-machine"
import {
  AUTO_TAB_GROUP_COLORS,
  buildComputedTabGroups,
  canonicalizeManualTabOrder,
  DEFAULT_TAB_GROUPS_STATE,
  nextManualGroupColor,
  nextManualGroupNumber,
  pruneEmptyManualGroups,
  reconcileManualAssignments,
  TAB_GROUP_MODES,
  TabGroupsStateSchema,
  type ComputedTabGroup,
  type ResolvedTabMeta,
  type TabGroupColor,
  type TabGroupMode,
} from "./tab-groups"
import type { CustomVerticalDragBinding, TabStripSection } from "./tab-strip"
import { sessionTabTitle } from "./tab-title"
import "./tab-groups.css"

type SectionPlan = {
  key: string
  tabs: Tab[]
  color: TabGroupColor
  collapsed: boolean
  ungrouped: boolean
}

function sameList<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function samePlans(a: SectionPlan[] | undefined, b: SectionPlan[] | undefined) {
  if (a === b) return true

  if (!a || !b || a.length !== b.length) return false

  return a.every((plan, index) => {
    const other = b[index]!

    return (
      plan.key === other.key &&
      plan.color === other.color &&
      plan.collapsed === other.collapsed &&
      plan.ungrouped === other.ungrouped &&
      sameList(plan.tabs, other.tabs)
    )
  })
}

export const { use: useTabGroups, provider: TabGroupsProvider } = createSimpleContext({
  name: "TabGroups",
  gate: false,
  init: (props: { currentTab: () => Tab | undefined }) => {
    const global = useGlobal()
    const servers = useServers()
    const settings = useSettings()
    const language = useLanguage()
    const tabs = useTabs()

    const [state, setState, , stateReady] = persisted(
      Persist.window("tabs.groups"),
      TabGroupsStateSchema,
      DEFAULT_TAB_GROUPS_STATE,
    )

    const [local, setLocal] = createStore({ query: "" })
    const [drag, setDrag] = createSignal(INITIAL_VERTICAL_DRAG_STATE)

    const mode = () => state.mode
    const serverCount = () => global.servers.list().length
    const effectiveMode = () => (mode() === "server" && serverCount() <= 1 ? "none" : mode())

    const connOf = (server: string) => global.servers.list().find((conn) => ServerConnection.key(conn) === server)

    // Migrate manual group membership when a draft promotes to a session, prune closed keys, and keep manual groups contiguous.
    let previousTabKeys: string[] = []
    createEffect(() => {
      if (!tabs.ready() || !stateReady()) return
      const nextKeys = tabs.store.map(tabKey)
      const isFreeform = effectiveMode() === "none"

      untrack(() => {
        const reconciled = reconcileManualAssignments(previousTabKeys, nextKeys, state.manualAssignments)
        const assignments = reconciled ?? state.manualAssignments

        if (reconciled) {
          setState(
            produce((draft) => {
              draft.manualAssignments = reconciled
              draft.manualGroups = pruneEmptyManualGroups(draft.manualGroups, reconciled)
            }),
          )
        }

        if (isFreeform && state.manualGroups.length > 0) {
          const canonical = canonicalizeManualTabOrder(nextKeys, assignments)

          if (!sameList(nextKeys, canonical)) {
            tabs.reorder(canonical)
          }
        }
      })

      previousTabKeys = nextKeys
    })

    const resolvedTabs = createMemo<ResolvedTabMeta[]>(() =>
      tabs.store.map((tab): ResolvedTabMeta => {
        const key = tabKey(tab)
        const conn = connOf(tab.server)
        const ctx = global.serverCtx(tab.server)
        const serverLabel = conn ? servers.label(conn) : tab.server

        if (tab.type === "draft") {
          const project = ctx?.projects.forDirectory(tab.directory)

          return {
            tab,
            key,
            title: language.t("session.tab.session"),
            server: tab.server,
            serverLabel,
            projectID: project?.id,
            projectName: project ? displayName(project) : displayName({ worktree: tab.directory }),
            directory: tab.directory,
            active: false,
          }
        }

        const session = ctx?.data.session.get(tab.sessionId)
        const persistedInfo = tabs.info[key]
        const directory = session?.location.directory ?? persistedInfo?.directory

        const project = session
          ? ctx?.projects.forSession(session)
          : directory
            ? ctx?.projects.forDirectory(directory)
            : undefined

        return {
          tab,
          key,
          title: sessionTabTitle(session ? session.title : persistedInfo?.title, language.t("session.tab.session")),
          server: tab.server,
          serverLabel,
          projectID: project?.id,
          projectName: project
            ? displayName(project)
            : directory
              ? displayName({ worktree: directory })
              : undefined,
          directory,
          active: false,
        }
      }),
    )

    const resolvedByKey = createMemo(() => new Map(resolvedTabs().map((meta) => [meta.key, meta])))

    const groups = createMemo(() =>
      buildComputedTabGroups({
        items: resolvedTabs(),
        state,
        mode: mode(),
        serverCount: serverCount(),
        knownServers: global.servers.list().map(ServerConnection.key),
        query: local.query,
        labels: {
          other: language.t("sidebar.view.other"),
        },
      }),
    )

    // Navigating into a session inside a collapsed group auto-expands that group so the active tab is visible.
    createEffect(
      on(
        () => props.currentTab(),
        (active) => {
          if (!active || !settings.general.tabGroups()) return
          const activeKey = tabKey(active)

          untrack(() => {
            const owner = groups()?.find(
              (group) => group.collapsed && group.allTabs.some((item) => tabKey(item) === activeKey),
            )

            if (owner) setState("collapsed", owner.key, false)
          })
        },
      ),
    )

    const toggleCollapsed = (groupKey: string) => {
      setState("collapsed", groupKey, !state.collapsed[groupKey])
    }

    const renameGroup = (group: ComputedTabGroup, nextName: string) => {
      if (group.kind === "manual" && group.manualId) {
        setState("manualGroups", (item) => item.id === group.manualId, "name", nextName)

        return
      }

      const existing = state.overrides[group.key]
      setState("overrides", group.key, {
        name: nextName,
        color: existing?.color,
      })
    }

    const recolorGroup = (group: ComputedTabGroup, color: TabGroupColor) => {
      if (group.kind === "manual" && group.manualId) {
        setState("manualGroups", (item) => item.id === group.manualId, "color", color)

        return
      }

      const existing = state.overrides[group.key]
      setState("overrides", group.key, {
        name: existing?.name,
        color,
      })
    }

    const formatUnnamedGroup = (number: number) => language.t("tabs.groups.unnamed", { number })

    const createManualGroup = (seedTabs?: Tab[], customName?: string) => {
      const id = uuid()
      const color = nextManualGroupColor(state.manualGroups)
      const number = nextManualGroupNumber(state.manualGroups, formatUnnamedGroup)
      const name = customName?.trim() || formatUnnamedGroup(number)
      const targets = seedTabs ?? (props.currentTab() ? [props.currentTab()!] : tabs.store.slice(0, 1))

      setState(
        produce((draft) => {
          draft.mode = "none"
          draft.manualGroups.push({ id, name, color })
          targets.forEach((tab) => {
            draft.manualAssignments[tabKey(tab)] = id
          })
        }),
      )

      return id
    }

    const assignTabToManualGroup = (tab: Tab, manualId: string | undefined) => {
      const key = tabKey(tab)
      setState(
        produce((draft) => {
          draft.mode = "none"

          if (!manualId) {
            delete draft.manualAssignments[key]
            draft.manualGroups = pruneEmptyManualGroups(draft.manualGroups, draft.manualAssignments)

            return
          }

          draft.manualAssignments[key] = manualId
          draft.manualGroups = pruneEmptyManualGroups(draft.manualGroups, draft.manualAssignments)
        }),
      )
    }

    const commitDrag = (blocks: readonly MeasuredTopBlock[], intent: VerticalDragIntent) => {
      const allTabKeys = tabs.store.map(tabKey)

      const result = applyVerticalDragCommit({
        allTabKeys,
        groups: groups(),
        blocks,
        state: {
          mode: effectiveMode(),
          groupOrder: state.groupOrder,
          collapsed: state.collapsed,
          overrides: state.overrides,
          manualGroups: state.manualGroups,
          manualAssignments: state.manualAssignments,
        },
        intent,
        createGroupId: uuid,
        createGroupName: formatUnnamedGroup,
      })

      setState(
        produce((draft) => {
          if (intent.type !== "move-group" || effectiveMode() === "none") {
            if (effectiveMode() === "none" && draft.mode !== "none") draft.mode = "none"

            if (intent.type === "combine-tabs" || intent.type === "join-group") draft.mode = "none"
          }

          draft.groupOrder = result.groupOrder
          draft.collapsed = result.collapsed
          draft.manualGroups = result.manualGroups
          draft.manualAssignments = result.manualAssignments
        }),
      )

      if (!sameList(allTabKeys, result.tabKeys)) {
        tabs.reorder(result.tabKeys)
      }
    }

    const ungroupManual = (manualId: string) => {
      setState(
        produce((draft) => {
          const index = draft.manualGroups.findIndex((item) => item.id === manualId)

          if (index !== -1) draft.manualGroups.splice(index, 1)
          Object.keys(draft.manualAssignments).forEach((key) => {
            if (draft.manualAssignments[key] === manualId) delete draft.manualAssignments[key]
          })
          delete draft.collapsed[`manual:${manualId}`]
        }),
      )
    }

    const closeGroup = (group: ComputedTabGroup) => {
      const groupKeys = new Set(group.allTabs.map(tabKey))
      const keep = tabs.store.find((item) => !groupKeys.has(tabKey(item)))

      if (keep) {
        tabs.closeTabs([...groupKeys], keep)

        if (group.kind === "manual" && group.manualId) ungroupManual(group.manualId)

        return
      }

      const indices = tabs.store
        .map((item, idx) => (groupKeys.has(tabKey(item)) ? idx : -1))
        .filter((idx) => idx !== -1)
        .toReversed()

      indices.forEach((idx) => tabs.closeTab(idx))

      if (group.kind === "manual" && group.manualId) ungroupManual(group.manualId)
    }

    const groupByKey = createMemo(() => new Map((groups() ?? []).map((group) => [group.key, group])))

    const groupByTabKey = createMemo(() => {
      const out = new Map<string, ComputedTabGroup>()

      ;(groups() ?? []).forEach((group) => {
        if (group.kind === "ungrouped") return
        group.allTabs.forEach((tab) => out.set(tabKey(tab), group))
      })

      return out
    })

    const plans = createMemo<SectionPlan[] | undefined>(
      () =>
        groups()?.map((group) => ({
          key: group.key,
          tabs: group.visibleTabs,
          color: group.color,
          collapsed: group.collapsed,
          ungrouped: group.kind === "ungrouped",
        })),
      undefined,
      { equals: samePlans },
    )

    // Thin pointer, dwell-timer & scroll driver for `transitionVerticalDrag`.
    let activeListEl: HTMLDivElement | undefined
    let activeScrollEl: HTMLDivElement | undefined
    let autoScrollFrame: number | undefined
    let autoScrollVelocity = 0
    let dwellTimer: ReturnType<typeof setTimeout> | undefined
    let cleanupListeners: (() => void) | undefined

    const clearDwellTimer = () => {
      if (dwellTimer !== undefined) clearTimeout(dwellTimer)
      dwellTimer = undefined
    }

    const stopAutoScroll = () => {
      if (autoScrollFrame !== undefined) cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = undefined
      autoScrollVelocity = 0
    }

    const detachWindowListeners = () => {
      cleanupListeners?.()
      cleanupListeners = undefined
      stopAutoScroll()
      clearDwellTimer()
    }

    const swallowTrailingClick = () => {
      if (typeof window === "undefined") return

      const eat = (clickEvent: MouseEvent) => {
        clickEvent.preventDefault()
        clickEvent.stopPropagation()
      }

      window.addEventListener("click", eat, { capture: true, once: true })
      requestAnimationFrame(() => window.removeEventListener("click", eat, true))
    }

    const dispatchDrag = (event: VerticalDragEvent, pointerButtons = 0) => {
      const previous = untrack(drag)
      const next = transitionVerticalDrag(previous, event)

      if (next.state !== previous) setDrag(next.state)
      next.effects.forEach((effect) => {
        if (effect.type === "capture-pointer") {
          if (activeListEl && pointerButtons !== 0 && !activeListEl.hasPointerCapture(effect.pointerId)) {
            activeListEl.setPointerCapture(effect.pointerId)
          }

          return
        }

        if (effect.type === "dwell.clear") {
          clearDwellTimer()

          return
        }

        if (effect.type === "dwell.start") {
          clearDwellTimer()
          const attempt = effect.attempt
          dwellTimer = setTimeout(() => dispatchDrag({ type: "dwell.elapsed", attempt }), effect.delayMs)

          return
        }

        if (effect.type === "suppress-click") {
          swallowTrailingClick()

          return
        }

        commitDrag(effect.blocks, effect.intent)
      })

      return next.state
    }

    onCleanup(() => {
      detachWindowListeners()
      dispatchDrag({ type: "disposed" })
    })

    const measureGeometry = (listEl: HTMLDivElement): VerticalDragGeometry => {
      const listRect = listEl.getBoundingClientRect()

      const slotRects = new Map<
        string,
        { top: number; bottom: number; tabTop: number; tabBottom: number }
      >()

      listEl.querySelectorAll<HTMLElement>("[data-titlebar-tab-slot][data-tab-key]").forEach((el) => {
        const key = el.dataset.tabKey

        if (!key) return
        const rect = el.getBoundingClientRect()
        const innerTab = el.querySelector<HTMLElement>("[data-titlebar-tab]")
        const tabRect = innerTab ? innerTab.getBoundingClientRect() : rect
        slotRects.set(key, {
          top: rect.top - listRect.top,
          bottom: rect.bottom - listRect.top,
          tabTop: tabRect.top - listRect.top,
          tabBottom: tabRect.bottom - listRect.top,
        })
      })

      const groupBoxRects = new Map<string, { top: number; bottom: number }>()
      listEl.querySelectorAll<HTMLElement>("[data-tab-group][data-group-key]").forEach((el) => {
        const key = el.dataset.groupKey

        if (!key) return
        const rect = el.getBoundingClientRect()
        groupBoxRects.set(key, { top: rect.top - listRect.top, bottom: rect.bottom - listRect.top })
      })

      const headerRects = new Map<string, { top: number; bottom: number }>()
      listEl.querySelectorAll<HTMLElement>("[data-tab-group-header][data-group-key]").forEach((el) => {
        const key = el.dataset.groupKey

        if (!key) return
        const rect = el.getBoundingClientRect()
        headerRects.set(key, { top: rect.top - listRect.top, bottom: rect.bottom - listRect.top })
      })

      const blocks: MeasuredTopBlock[] = []
      const rows: MeasuredStripRow[] = []
      const currentGroups = groups()

      if (!currentGroups) {
        tabs.store.forEach((tab) => {
          const key = tabKey(tab)
          const bounds = slotRects.get(key)

          if (!bounds) return
          blocks.push({ kind: "tab", tabKey: key, top: bounds.top, bottom: bounds.bottom })
          rows.push({
            kind: "tab",
            tabKey: key,
            groupKey: undefined,
            manualId: undefined,
            color: undefined,
            isFirstInGroup: false,
            isLastInGroup: false,
            top: bounds.top,
            bottom: bounds.bottom,
            tabTop: bounds.tabTop,
            tabBottom: bounds.tabBottom,
          })
        })

        return {
          listLeft: listRect.left,
          freeform: effectiveMode() === "none",
          nextGroupColor: nextManualGroupColor(state.manualGroups),
          blocks,
          rows,
        }
      }

      currentGroups.forEach((group) => {
        if (group.kind === "ungrouped") {
          group.visibleTabs.forEach((tab) => {
            const key = tabKey(tab)
            const bounds = slotRects.get(key)

            if (!bounds) return
            blocks.push({ kind: "tab", tabKey: key, top: bounds.top, bottom: bounds.bottom })
            rows.push({
              kind: "tab",
              tabKey: key,
              groupKey: undefined,
              manualId: undefined,
              color: undefined,
              isFirstInGroup: false,
              isLastInGroup: false,
              top: bounds.top,
              bottom: bounds.bottom,
              tabTop: bounds.tabTop,
              tabBottom: bounds.tabBottom,
            })
          })

          return
        }

        const groupBounds = groupBoxRects.get(group.key) ?? headerRects.get(group.key)
        const headerBounds = headerRects.get(group.key) ?? groupBounds
        const allKeys = group.allTabs.map(tabKey)

        if (groupBounds) {
          blocks.push({
            kind: "group",
            groupKey: group.key,
            manualId: group.manualId,
            tabKeys: allKeys,
            top: groupBounds.top,
            bottom: groupBounds.bottom,
          })
        }

        if (headerBounds) {
          rows.push({
            kind: "header",
            groupKey: group.key,
            manualId: group.manualId,
            color: group.color,
            collapsed: group.collapsed,
            firstTabKey: allKeys[0],
            lastTabKey: allKeys[allKeys.length - 1],
            top: headerBounds.top,
            bottom: headerBounds.bottom,
          })
        }

        group.visibleTabs.forEach((tab, idx) => {
          const key = tabKey(tab)
          const bounds = slotRects.get(key)

          if (!bounds) return
          rows.push({
            kind: "tab",
            tabKey: key,
            groupKey: group.key,
            manualId: group.manualId,
            color: group.color,
            isFirstInGroup: idx === 0,
            isLastInGroup: idx === group.visibleTabs.length - 1,
            top: bounds.top,
            bottom: bounds.bottom,
            tabTop: bounds.tabTop,
            tabBottom: bounds.tabBottom,
          })
        })
      })

      return {
        listLeft: listRect.left,
        freeform: effectiveMode() === "none",
        nextGroupColor: nextManualGroupColor(state.manualGroups),
        blocks,
        rows,
      }
    }

    const stepAutoScroll = () => {
      if (!activeScrollEl || !activeListEl || autoScrollVelocity === 0) {
        autoScrollFrame = undefined

        return
      }

      const before = activeScrollEl.scrollTop
      activeScrollEl.scrollTop += autoScrollVelocity

      if (activeScrollEl.scrollTop !== before) {
        const current = untrack(drag)

        if (current.status === "dragging") {
          const contentY = current.currentY - activeListEl.getBoundingClientRect().top
          dispatchDrag({ type: "scroll.changed", contentY })
        }
      }

      autoScrollFrame = requestAnimationFrame(stepAutoScroll)
    }

    const updateAutoScroll = (clientY: number) => {
      if (!activeScrollEl) return
      const rect = activeScrollEl.getBoundingClientRect()
      const edge = 28

      if (clientY < rect.top + edge && activeScrollEl.scrollTop > 0) {
        autoScrollVelocity = -Math.ceil(((rect.top + edge - clientY) / edge) * 7)

        if (autoScrollFrame === undefined) autoScrollFrame = requestAnimationFrame(stepAutoScroll)

        return
      }

      if (
        clientY > rect.bottom - edge &&
        activeScrollEl.scrollTop < activeScrollEl.scrollHeight - activeScrollEl.clientHeight
      ) {
        autoScrollVelocity = Math.ceil(((clientY - (rect.bottom - edge)) / edge) * 7)

        if (autoScrollFrame === undefined) autoScrollFrame = requestAnimationFrame(stepAutoScroll)

        return
      }

      stopAutoScroll()
    }

    const cancelDrag = () => {
      detachWindowListeners()
      dispatchDrag({ type: "cancel" })
    }

    const onPointerDown = (event: PointerEvent, listEl: HTMLDivElement, scrollEl: HTMLDivElement) => {
      if (event.pointerType !== "touch" && event.button !== 0) return

      // While an inline filter hides non-matching rows, dragging would only measure visible blocks and push hidden tabs behind them.
      if (local.query.trim().length > 0) return

      if (!(event.target instanceof Element)) return

      if (
        event.target.closest(
          '[data-slot="tab-close"], [data-group-menu-trigger], [contenteditable="true"], [contenteditable="plaintext-only"]',
        )
      )
        return

      let source: VerticalDragSource | undefined

      const headerEl = event.target.closest<HTMLElement>("[data-tab-group-header][data-group-key]")

      if (headerEl?.dataset.groupKey) {
        const group = groupByKey().get(headerEl.dataset.groupKey)

        if (group && group.kind !== "ungrouped") {
          source = {
            kind: "group",
            groupKey: group.key,
            label: group.name,
            color: group.color,
            count: group.allTabs.length,
          }
        }
      }

      if (!source) {
        const slotEl = event.target.closest<HTMLElement>("[data-titlebar-tab-slot][data-tab-key]")
        const key = slotEl?.dataset.tabKey

        if (key) {
          const group = groupByTabKey().get(key)
          const meta = resolvedByKey().get(key)
          source = {
            kind: "tab",
            tabKey: key,
            label: meta?.title ?? language.t("session.tab.session"),
            groupKey: group?.key,
            manualId: group?.manualId,
          }
        }
      }

      if (!source) return
      detachWindowListeners()
      activeListEl = listEl
      activeScrollEl = scrollEl

      dispatchDrag({
        type: "pointer.down",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        source,
      })

      const onMove = (moveEvent: PointerEvent) => {
        if (!activeListEl) return
        const contentY = moveEvent.clientY - activeListEl.getBoundingClientRect().top

        const geometry = selectNeedsDragMeasurement(
          untrack(drag),
          moveEvent.pointerId,
          moveEvent.clientX,
          moveEvent.clientY,
        )
          ? measureGeometry(activeListEl)
          : undefined

        const nextState = dispatchDrag(
          {
            type: "pointer.move",
            pointerId: moveEvent.pointerId,
            x: moveEvent.clientX,
            y: moveEvent.clientY,
            contentY,
            geometry,
          },
          moveEvent.buttons,
        )

        if (nextState.status === "dragging") {
          if (moveEvent.cancelable) moveEvent.preventDefault()
          updateAutoScroll(moveEvent.clientY)
        }
      }

      const onUp = (upEvent: PointerEvent) => {
        detachWindowListeners()
        dispatchDrag({ type: "pointer.up", pointerId: upEvent.pointerId })
      }

      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault()
          cancelDrag()
        }
      }

      window.addEventListener("pointermove", onMove, { passive: false })
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", cancelDrag)
      window.addEventListener("blur", cancelDrag)
      window.addEventListener("keydown", onKeyDown, true)

      cleanupListeners = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", cancelDrag)
        window.removeEventListener("blur", cancelDrag)
        window.removeEventListener("keydown", onKeyDown, true)
      }
    }

    const onScroll = (listEl: HTMLDivElement) => {
      const current = untrack(drag)

      if (current.status !== "dragging") return
      const contentY = current.currentY - listEl.getBoundingClientRect().top
      dispatchDrag({ type: "scroll.changed", contentY })
    }

    const dragBinding: CustomVerticalDragBinding = {
      isDraggingStrip: () => selectIsDraggingStrip(drag()),
      isDraggingTab: (key: string) => selectDraggingTabKey(drag()) === key,
      isDraggingGroup: (groupKey: string) => selectDraggingGroupKey(drag()) === groupKey,
      isDropInsideGroup: (groupKey: string) => selectDropInsideGroupKey(drag()) === groupKey,
      tabTransformY: (key: string) => {
        const current = drag()

        return selectDraggingTabKey(current) === key
          ? selectDraggedOffsetY(current)
          : selectTabShiftY(current, key)
      },
      tabLaneShift: (key: string) => {
        const current = drag()

        return selectDraggingTabKey(current) === key ? selectDraggedLaneShift(current) : undefined
      },
      groupTransformY: (groupKey: string) => {
        const current = drag()

        return selectDraggingGroupKey(current) === groupKey
          ? selectDraggedOffsetY(current)
          : selectGroupShiftY(current, groupKey)
      },
      groupRailAdjustment: (groupKey: string) => selectGroupRailAdjustment(drag(), groupKey),
      combineOfTab: (key: string) => selectCombineOfTab(drag(), key),
      onPointerDown,
      onScroll,
    }

    return {
      state,
      mode,
      effectiveMode,
      plans,
      dragBinding,
      isJoinTarget: (groupKey: string) => selectJoinGroupKey(drag()) === groupKey,
      headerShiftY: (groupKey: string) => selectHeaderShiftY(drag(), groupKey),
      query: () => local.query,
      setQuery: (value: string) => setLocal("query", value),
      setMode: (next: TabGroupMode) => setState("mode", next),
      groups,
      groupOfKey: (key: string) => groupByKey().get(key),
      manualGroups: () => state.manualGroups,
      manualGroupOf: (tab: Tab) => state.manualAssignments[tabKey(tab)],
      toggleCollapsed,
      renameGroup,
      recolorGroup,
      createManualGroup,
      assignTabToManualGroup,
      ungroupManual,
      closeGroup,
    }
  },
})

export function createVerticalTabGroupSections() {
  const tabGroups = useTabGroups()

  return createMemo(() =>
    tabGroups.plans()?.map(
      (plan): TabStripSection => ({
        key: plan.key,
        tabs: plan.tabs,
        header: plan.ungrouped ? undefined : <TabGroupHeaderLookup groupKey={plan.key} />,
        groupMeta: {
          color: plan.color,
          collapsed: plan.collapsed,
          ungrouped: plan.ungrouped,
        },
      }),
    ),
  )
}

function GroupEditorMenuItems(props: { group: ComputedTabGroup }) {
  const tabGroups = useTabGroups()
  const language = useLanguage()

  return (
    <>
      <div class="p-1.5" onKeyDown={(event) => event.stopPropagation()}>
        <TextInput
          appearance="base"
          surface="layer-1"
          class="!w-full min-w-0"
          dir="auto"
          value={props.group.name}
          placeholder={props.group.defaultName || language.t("tabs.groups.name.placeholder")}
          aria-label={language.t("tabs.groups.name.placeholder")}
          onFocusIn={(event) => event.stopPropagation()}
          onInput={(event) => tabGroups.renameGroup(props.group, event.currentTarget.value)}
        />
        <div
          class="mt-2 flex items-center justify-between gap-1 px-0.5"
          role="radiogroup"
          aria-label={language.t("tabs.groups.color")}
        >
          <For each={AUTO_TAB_GROUP_COLORS}>
            {(color) => {
              const selected = () => props.group.color === color

              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected()}
                  aria-label={language.t(`tabs.groups.color.${color}`)}
                  title={language.t(`tabs.groups.color.${color}`)}
                  data-group-color={color}
                  class="flex size-5 items-center justify-center rounded-full transition-transform hover:scale-110"
                  classList={{
                    "ring-2 ring-v2-text-text-base ring-offset-1 ring-offset-v2-background-bg-base": selected(),
                  }}
                  onClick={() => tabGroups.recolorGroup(props.group, color)}
                >
                  <span data-group-swatch class="block size-3.5 rounded-full" />
                </button>
              )
            }}
          </For>
        </div>
      </div>
      <Show when={props.group.kind === "manual" || props.group.allTabs.length > 0}>
        <Menu.Separator />
      </Show>
      <Show when={props.group.kind === "manual" && props.group.manualId}>
        {(manualId) => (
          <Menu.Item onSelect={() => tabGroups.ungroupManual(manualId())}>
            <span>{language.t("tabs.groups.ungroup")}</span>
          </Menu.Item>
        )}
      </Show>
      <Show when={props.group.allTabs.length > 0}>
        <Menu.Item onSelect={() => tabGroups.closeGroup(props.group)}>
          <span>{language.t("tabs.groups.closeGroup")}</span>
        </Menu.Item>
      </Show>
    </>
  )
}

function TabGroupHeaderLookup(props: { groupKey: string }) {
  const tabGroups = useTabGroups()

  return <Show when={tabGroups.groupOfKey(props.groupKey)}>{(group) => <TabGroupHeader group={group()} />}</Show>
}

export function TabGroupHeader(props: { group: ComputedTabGroup }) {
  const tabGroups = useTabGroups()
  const language = useLanguage()
  const [menu, setMenu] = createStore({ open: false })
  const count = () => props.group.allTabs.length
  const shiftY = () => tabGroups.headerShiftY(props.group.key)

  return (
    <div
      data-tab-group-header
      data-orientation="vertical"
      data-group-key={props.group.key}
      data-group-color={props.group.color}
      data-drop-over={tabGroups.isJoinTarget(props.group.key) ? "true" : undefined}
      style={shiftY() ? { transform: `translate3d(0, ${shiftY()}px, 0)` } : undefined}
      class="group/group-row relative flex w-full min-w-0 shrink-0 select-none items-center gap-1.5 rounded-[6px]"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu("open", true)
      }}
    >
      <button
        type="button"
        aria-expanded={!props.group.collapsed}
        onClick={() => tabGroups.toggleCollapsed(props.group.key)}
        class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[6px] text-start focus-visible:-outline-offset-2"
      >
        <span data-tab-group-chip data-group-color={props.group.color} class="max-w-full min-w-0">
          <span class="min-w-0 truncate" dir="auto">
            {props.group.name}
          </span>
        </span>
        <Show when={props.group.collapsed && count() > 0}>
          <span class="shrink-0 text-[11px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
            {count()}
          </span>
        </Show>
        <Icon
          name="chevron-down"
          class="ms-auto shrink-0 text-v2-icon-icon-muted opacity-0 transition-[transform,opacity] duration-[120ms] ease-out motion-reduce:transition-none group-hover/group-row:opacity-100"
          classList={{ "-rotate-90 rtl:rotate-90 opacity-100": props.group.collapsed }}
        />
      </button>
      <Menu
        modal={false}
        gutter={4}
        placement="bottom-end"
        open={menu.open}
        onOpenChange={(open) => setMenu("open", open)}
      >
        <Menu.Trigger
          as={IconButton}
          variant="ghost-muted"
          size="small"
          data-group-menu-trigger
          aria-label={language.t("common.moreOptions")}
          icon={<Icon name="outline-dots" />}
          class="shrink-0 opacity-0 group-hover/group-row:opacity-100 data-[expanded]:opacity-100"
        />
        <Menu.Portal>
          <Menu.Content class="w-48">
            <GroupEditorMenuItems group={props.group} />
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}

export function TabAddToGroupMenuItems(props: { tab: Tab }) {
  const tabGroups = useTabGroups()
  const language = useLanguage()
  const assigned = () => tabGroups.manualGroupOf(props.tab)

  return (
    <Show
      when={tabGroups.manualGroups().length > 0}
      fallback={
        <Menu.Item onSelect={() => tabGroups.createManualGroup([props.tab])}>{language.t("tabs.groups.new")}</Menu.Item>
      }
    >
      <Menu.Sub gutter={4} overflowPadding={16} overlap>
        <Menu.SubTrigger class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
          <span>{language.t("tabs.groups.addToGroup")}</span>
        </Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent class="min-w-[164px]">
            <Menu.Item onSelect={() => tabGroups.createManualGroup([props.tab])}>
              <Icon name="plus" />
              <span>{language.t("tabs.groups.new")}</span>
            </Menu.Item>
            <Menu.Separator />
            <For each={tabGroups.manualGroups()}>
              {(group) => (
                <Menu.CheckboxItem
                  closeOnSelect
                  checked={assigned() === group.id}
                  onChange={(checked) => tabGroups.assignTabToManualGroup(props.tab, checked ? group.id : undefined)}
                >
                  <span data-group-color={group.color} class="inline-flex items-center">
                    <span data-group-swatch class="size-2.5 shrink-0 rounded-full" />
                  </span>
                  <span class="min-w-0 truncate" dir="auto">
                    {group.name}
                  </span>
                </Menu.CheckboxItem>
              )}
            </For>
            <Show when={assigned()}>
              <Menu.Separator />
              <Menu.Item onSelect={() => tabGroups.assignTabToManualGroup(props.tab, undefined)}>
                <span>{language.t("tabs.groups.removeFromGroup")}</span>
              </Menu.Item>
            </Show>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
    </Show>
  )
}

export function TabGroupingMenu() {
  const tabGroups = useTabGroups()
  const language = useLanguage()

  return (
    <Menu gutter={4} modal={false} placement="bottom-end">
      <Menu.Trigger
        as="button"
        type="button"
        aria-label={language.t("tabs.groups.menu")}
        title={language.t("tabs.groups.menu")}
        data-action="tab-groups-menu"
        class="my-auto flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:-outline-offset-2 [app-region:no-drag]"
      >
        <Icon name="sliders" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content class="min-w-[168px]">
          <Menu.Group>
            <Menu.GroupLabel>{language.t("tabs.groups.groupBy")}</Menu.GroupLabel>
            <Menu.RadioGroup
              value={tabGroups.mode()}
              onChange={(value) => {
                const next = TAB_GROUP_MODES.find((item) => item === value)

                if (next) tabGroups.setMode(next)
              }}
            >
              <For each={TAB_GROUP_MODES}>
                {(modeOption) => (
                  <Menu.RadioItem closeOnSelect value={modeOption}>
                    {language.t(`tabs.groups.mode.${modeOption}`)}
                  </Menu.RadioItem>
                )}
              </For>
            </Menu.RadioGroup>
          </Menu.Group>
          <Show when={tabGroups.effectiveMode() === "none"}>
            <Menu.Separator />
            <Menu.Item onSelect={() => tabGroups.createManualGroup()}>
              <Icon name="plus" />
              <span>{language.t("tabs.groups.new")}</span>
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

export function TabFilterInput(props: { trailing?: JSX.Element }) {
  const tabGroups = useTabGroups()
  const language = useLanguage()
  let inputRef: HTMLInputElement | undefined

  return (
    <div data-slot="sidebar-search-input" class="min-w-0 flex-1">
      <TextInput
        ref={(el) => {
          inputRef = el
        }}
        type="text"
        dir="auto"
        appearance="base"
        surface="layer-1"
        class="!w-full min-w-0 [app-region:no-drag]"
        leadingIcon={<Icon name="magnifying-glass" />}
        showClearButton={tabGroups.query().length > 0}
        clearIcon="close"
        onClearClick={() => {
          tabGroups.setQuery("")
          inputRef?.focus()
        }}
        trailing={props.trailing}
        aria-label={language.t("tabs.groups.filter.placeholder")}
        placeholder={language.t("tabs.groups.filter.placeholder")}
        spellcheck={false}
        autocomplete="off"
        value={tabGroups.query()}
        onInput={(event) => tabGroups.setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return

          if (tabGroups.query()) {
            event.preventDefault()
            tabGroups.setQuery("")

            return
          }

          inputRef?.blur()
        }}
      />
    </div>
  )
}

export function VerticalTabGroupsControls() {
  return (
    <div class="my-2.5 flex w-full shrink-0 items-center">
      <TabFilterInput trailing={<TabGroupingMenu />} />
    </div>
  )
}

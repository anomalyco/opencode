/**
 * Claxedo Layout Context Extension
 *
 * Extends upstream layout.tsx with rail-specific state for the new UI architecture.
 * This file is Claxedo-specific and does not modify upstream files.
 */

import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@opencode-ai/claxedo-app"
import { createClaxedoLayoutFacade } from "./claxedo-layout/facade"
import { createEmptyTabsState, defaultGroupLayout, type ClaxedoLayoutStore } from "./claxedo-layout/types"

export type {
  TabType,
  TabItem,
  RailState,
  TopTabsState,
  WorktreeState,
  Pane,
  PaneDir,
  GroupLayoutState,
  GroupState,
  SplitState,
  TerminalActionOrigin,
  TerminalAgentStatus,
  TerminalLifecycleState,
} from "./claxedo-layout/types"

const migrateLayout = (value: unknown) => {
  if (!value || typeof value !== "object") return value

  if ("tabs" in value && !("groups" in value)) {
    const v = value as Record<string, unknown>
    const id = "g-initial"
    return {
      ...v,
      groups: [
        {
          id,
          tabs: v.tabs,
          worktree: v.worktree ?? { default: null, pinned: null },
          layout: defaultGroupLayout(),
        },
      ],
      split: { direction: "h", sizes: [1.0], focusedId: id },
    }
  }

  if ("groups" in value) {
    const v = value as Record<string, unknown>
    const groups = v.groups
    if (Array.isArray(groups) && groups.length === 0) {
      const id = "g-default"
      return {
        ...v,
        groups: [
          {
            id,
            tabs: createEmptyTabsState(),
            worktree: { default: null, pinned: null },
            layout: defaultGroupLayout(),
          },
        ],
        split: { direction: "h", sizes: [1.0], focusedId: id },
      }
    }

    if (Array.isArray(groups) && groups.some((g: any) => !g.layout)) {
      return {
        ...v,
        groups: groups.map((g: any) => (g.layout ? g : { ...g, layout: defaultGroupLayout() })),
      }
    }

    if (Array.isArray(groups) && groups.some((g: any) => g.layout && !g.layout.reviewPanel)) {
      return {
        ...v,
        groups: groups.map((g: any) =>
          g.layout && !g.layout.reviewPanel ? { ...g, layout: { ...g.layout, reviewPanel: defaultGroupLayout().reviewPanel } } : g,
        ),
      }
    }

    return value
  }

  if (!("workspaceTabs" in value)) return value

  const wsTabs = (value as { workspaceTabs?: unknown }).workspaceTabs
  if (!wsTabs || typeof wsTabs !== "object") return value

  const wsActive = (value as { activeWorkspaceId?: unknown }).activeWorkspaceId
  const active = typeof wsActive === "string" ? wsActive : null

  const entries = Object.entries(wsTabs as Record<string, unknown>)
    .map(([dir, raw]) => {
      if (!raw || typeof raw !== "object") return
      const items = (raw as { items?: unknown }).items
      if (!Array.isArray(items)) return
      const order = (raw as { order?: unknown }).order
      const ids = Array.isArray(order) ? order.filter((x): x is string => typeof x === "string") : []
      const list = items
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((t) => ({ ...t, directory: typeof t.directory === "string" ? t.directory : dir })) as unknown[]
      return { dir, ids, list }
    })
    .filter((x): x is { dir: string; ids: string[]; list: unknown[] } => !!x)

  const list = entries.flatMap((x) => x.list)
  const order = (() => {
    const first = active ? entries.find((e) => e.dir === active) : undefined
    const rest = entries.filter((e) => e.dir !== active)
    const base = [first, ...rest].filter((e): e is { dir: string; ids: string[]; list: unknown[] } => !!e)
    return base.flatMap((e) => e.ids)
  })()

  const activeId = (() => {
    if (typeof active !== "string") return null
    const raw = (wsTabs as Record<string, unknown>)[active]
    if (!raw || typeof raw !== "object") return null
    const id = (raw as { activeId?: unknown }).activeId
    if (typeof id === "string") return id
    return null
  })()

  const id = "g-initial"
  return {
    ...(value as Record<string, unknown>),
    groups: [
      {
        id,
        tabs: {
          items: list,
          activeId,
          order,
          closedTabs: [],
        },
        worktree: {
          default: active,
          pinned: null,
        },
      },
    ],
    split: { direction: "h", sizes: [1.0], focusedId: id },
  }
}

export const { use: useClaxedoLayout, provider: ClaxedoLayoutProvider } = createSimpleContext({
  name: "ClaxedoLayout",
  init: () => {
    const target = {
      ...Persist.global("claxedo.layout", ["claxedo.layout.v1"]),
      migrate: migrateLayout,
    }

    const [store, setStore, _, ready] = persisted(
      target,
      createStore<ClaxedoLayoutStore>({
        rail: {
          collapsed: true,
          hovered: false,
          pinned: false,
          locked: false,
        },
        groups: [
          {
            id: "g-default",
            tabs: createEmptyTabsState(),
            worktree: { default: null, pinned: null },
            layout: defaultGroupLayout(),
          },
        ],
        split: { direction: "h", sizes: [1.0], focusedId: "g-default" },
        enabled: true,
        terminalPane: {},
        terminalFocus: {},
        terminalZoom: {},
        terminalOwner: {},
        terminalAgentStatus: {},
        terminalAgentSeen: {},
        terminalLifecycle: {},
        workspaceRecency: {},
        worktreeColorMap: {},
      }),
    )

    return createClaxedoLayoutFacade({
      store,
      setStore,
      ready,
    })
  },
})

import { createStore, produce } from "solid-js/store"

export type StatusColor = "default" | "green" | "yellow" | "red" | "blue" | "gray"

export interface StatusRenderBase {
  icon?: string
  text: string
  color?: StatusColor
}

export interface StatusRenderLong extends StatusRenderBase {
  detail?: string
  progress?: number
  subtext?: string
}

export type StatusRenderShort = StatusRenderBase

export type StatusItemRender = {
  long: StatusRenderLong
  short: StatusRenderShort | null
}

export interface StatusItem {
  id: string
  priority?: number
  render: {
    long: () => StatusRenderLong
    short?: () => StatusRenderShort | null
  }
}

export interface StatusHandle {
  update: (render: { long?: Partial<StatusRenderLong>; short?: Partial<StatusRenderShort> | null }) => void
  remove: () => void
}

type StatusItemState = {
  id: string
  priority?: number
  long: StatusRenderLong
  short: StatusRenderShort | null
}

export type StatusState = {
  items: Record<string, StatusItemState>
}

// Local store for status items - TUI receives updates via event bus
const [statusStore, setStatusStore] = createStore<StatusState>({ items: {} })

// Publish status updates via the event bus so TUI can receive them
async function publishStatusUpdate() {
  // Use dynamic imports to avoid circular dependencies and context issues in tests
  try {
    const { Bus } = await import("../bus")
    const { TuiEvent } = await import("../cli/cmd/tui/event")
    Bus.publish(TuiEvent.StatusUpdated, { items: statusStore.items })
  } catch {
    // Ignore errors when context is not available (e.g., in tests)
  }
}

export function register(item: StatusItem): StatusHandle {
  setStatusStore("items", item.id, {
    id: item.id,
    priority: item.priority,
    long: item.render.long(),
    short: item.render.short?.() ?? null,
  })
  publishStatusUpdate()

  return {
    update: ({ long, short }) => {
      setStatusStore((state) => {
        const existing = state.items[item.id]
        if (!existing) return state

        const updated = { ...existing }
        if (long) {
          updated.long = { ...existing.long, ...long }
        }
        if (short === null) {
          updated.short = null
        } else if (short !== undefined) {
          if (existing.short) {
            updated.short = { ...existing.short, ...short }
          } else {
            updated.short = short as StatusRenderShort
          }
        }
        return {
          ...state,
          items: {
            ...state.items,
            [item.id]: updated,
          },
        }
      })
      publishStatusUpdate()
    },
    remove: () => {
      setStatusStore(
        produce((state) => {
          delete state.items[item.id]
        }),
      )
      publishStatusUpdate()
    },
  }
}

export function getAll(): Array<{ id: string; priority?: number }> {
  return Object.values(statusStore.items)
}

export function getFooterItems(): Array<{ id: string; render: StatusRenderShort; priority?: number }> {
  return Object.values(statusStore.items)
    .filter((item): item is StatusItemState & { short: StatusRenderShort } => item.short !== null)
    .map((item) => ({ id: item.id, render: item.short, priority: item.priority }))
}

export function getSidebarItems(): Array<{ id: string; render: StatusRenderLong; priority?: number }> {
  return Object.values(statusStore.items).map((item) => ({
    id: item.id,
    render: item.long,
    priority: item.priority,
  }))
}

export const statusRegistry = {
  register,
  getAll,
  getFooterItems,
  getSidebarItems,
}

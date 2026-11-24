import type { PinRef, PinTarget } from "@/shell/tabs/pins"
import { ServerConnection } from "@/runtime/server/registry"

export type PinDragSource = { kind: "session"; ref: PinRef } | { kind: "group"; id: string }

type Point = { x: number; y: number }

/** Slack across the pinned area that still counts as over it, so its edges are easy to hit. */
const SLOP = 12

/** A pinned row's sortable id: `session:<server>\u0000<session>`. */
export const sessionKey = (ref: PinRef) => `session:${ref.server}\u0000${ref.sessionId}`

/** A pinned group's sortable id. */
export const groupKey = (id: string) => `group:${id}`

/** Reads a pinned row's or group's sortable id back. */
export function pinDragSourceOf(id: string): PinDragSource | undefined {
  if (id.startsWith("group:")) return { kind: "group", id: id.slice("group:".length) }

  if (!id.startsWith("session:")) return
  const [server, sessionId] = id.slice("session:".length).split("\u0000")

  if (!server || !sessionId) return

  return { kind: "session", ref: { server: ServerConnection.Key.make(server), sessionId } }
}

/**
 * Where a drag at `point` lands, read from the rendered rows. The pinned area runs from the start of the strip to its
 * divider, so anything before the divider counts as pinned: past it is `"outside"`. Indexes count rows without the
 * dragged one, as `place` and `moveGroup` expect.
 */
export function pinDropTarget(point: Point, source: PinDragSource): PinTarget | "outside" {
  const area = [...document.querySelectorAll<HTMLElement>('[data-component="pinned-area"]')].find((element) =>
    before(element.getBoundingClientRect(), point, element.dataset.orientation === "vertical"),
  )

  if (!area) return "outside"
  const vertical = area.dataset.orientation === "vertical"
  const dragged = source.kind === "session" ? sessionKey(source.ref) : groupKey(source.id)

  if (source.kind === "session") {
    const group = [...area.querySelectorAll<HTMLElement>("[data-pin-group]")].find((element) => {
      const rect = element.getBoundingClientRect()

      return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    })

    if (group) {
      const rows = [...group.querySelectorAll<HTMLElement>("[data-pin-group-row]")].filter(
        (element) => element.dataset.pinGroupRow !== dragged,
      )

      return { group: group.dataset.pinGroup, index: indexAt(rows, point, vertical, Number.MAX_SAFE_INTEGER) }
    }
  }

  const items = [...area.querySelectorAll<HTMLElement>("[data-pin-item]")].filter(
    (element) => element.dataset.pinItem !== dragged,
  )

  return { index: indexAt(items, point, vertical, items.length) }
}

/** The tab key a drop at `point` lands before in the tab strip, or undefined for the end. */
export function stripDropBefore(point: Point) {
  const slots = [...document.querySelectorAll<HTMLElement>("[data-titlebar-tab-slot][data-tab-key]")].filter(
    (element) => !element.closest('[data-component="pinned-area"]') && !element.hasAttribute("data-dnd-placeholder"),
  )

  const vertical = slots[0]?.dataset.orientation === "vertical"

  return slots.find((element) => {
    const rect = element.getBoundingClientRect()

    return vertical ? point.y < rect.top + rect.height / 2 : point.x < rect.left + rect.width / 2
  })?.dataset.tabKey
}

// Over the pinned area's span across the strip, and not yet past its end along it.
function before(rect: DOMRect, point: Point, vertical: boolean) {
  if (vertical) return point.x >= rect.left - SLOP && point.x <= rect.right + SLOP && point.y < rect.bottom

  return point.y >= rect.top - SLOP && point.y <= rect.bottom + SLOP && point.x < rect.right
}

function indexAt(elements: HTMLElement[], point: Point, vertical: boolean, fallback: number) {
  const index = elements.findIndex((element) => {
    const rect = element.getBoundingClientRect()

    return vertical ? point.y < rect.top + rect.height / 2 : point.x < rect.left + rect.width / 2
  })

  return index === -1 ? fallback : index
}

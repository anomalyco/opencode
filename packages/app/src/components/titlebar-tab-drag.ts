export type TabDragLayout = {
  tabWidthById: Map<string, number>
  dividerWidth: number
  listLeft: number
}

export const ACTIVATION_DISTANCE = 4
export const HYSTERESIS_DEADBAND = 8
export const AUTOSCROLL_EDGE = 24
export const AUTOSCROLL_MAX_SPEED = 8
export const FLOATER_OVERSHOOT_MAX = 8

export function pointerDistance(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

export function captureTabDragLayout(list: HTMLElement, order: string[]) {
  const tabWidthById = new Map<string, number>()
  const slots = list.querySelectorAll<HTMLElement>("[data-titlebar-tab-slot]")
  for (const slot of slots) {
    const id = slot.dataset.tabKey
    if (!id) continue
    const tab = slot.matches("[data-titlebar-tab]") ? slot : slot.querySelector<HTMLElement>("[data-titlebar-tab]")
    if (!tab) continue
    tabWidthById.set(id, tab.getBoundingClientRect().width)
  }

  let dividerWidth = 0
  if (order.length >= 2) {
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0
    const secondId = order[1]
    for (const slot of slots) {
      if (slot.dataset.tabKey !== secondId) continue
      const tab = slot.matches("[data-titlebar-tab]") ? slot : slot.querySelector<HTMLElement>("[data-titlebar-tab]")
      if (!tab) break
      const style = getComputedStyle(slot)
      dividerWidth =
        gap ||
        slot.getBoundingClientRect().width -
          tab.getBoundingClientRect().width +
          (Number.parseFloat(style.marginLeft) || 0) +
          (Number.parseFloat(style.marginRight) || 0)
      break
    }
  }

  return {
    tabWidthById,
    dividerWidth,
    listLeft: list.getBoundingClientRect().left,
  }
}

export function syncLayoutScroll(list: HTMLElement, layout: TabDragLayout) {
  layout.listLeft = list.getBoundingClientRect().left
}

function slotWidthAt(order: readonly string[], index: number, layout: TabDragLayout) {
  const id = order[index]
  if (!id) return 0
  const tabWidth = layout.tabWidthById.get(id) ?? 0
  return index === 0 ? tabWidth : layout.dividerWidth + tabWidth
}

function slotLeft(order: readonly string[], index: number, layout: TabDragLayout) {
  let left = layout.listLeft
  for (let i = 0; i < index; i++) {
    left += slotWidthAt(order, i, layout)
  }
  return left
}

export function insertIndexFromVirtualLayout(
  pointerX: number,
  order: readonly string[],
  draggedId: string,
  currentIndex: number,
  layout: TabDragLayout,
  deadband = HYSTERESIS_DEADBAND,
) {
  if (order.length === 0) return 0

  const others = order.filter((id) => id !== draggedId)
  let target = currentIndex

  while (target > 0 && pointerX < slotLeft(others, target, layout) - deadband) target--
  while (target < order.length - 1 && pointerX >= slotLeft(others, target + 1, layout)) target++

  return target
}

export function movePlaceholder(order: readonly string[], draggedId: string, toIndex: number) {
  const fromIndex = order.indexOf(draggedId)
  if (fromIndex === -1 || fromIndex === toIndex) return [...order]
  const next = [...order]
  next.splice(toIndex, 0, ...next.splice(fromIndex, 1))
  return next
}

export function draftOrderChanged(initial: readonly string[], final: readonly string[]) {
  if (initial.length === 0 || final.length === 0 || initial.length !== final.length) return false
  return final.some((key, index) => key !== initial[index])
}

function easeOvershoot(overshoot: number) {
  return (FLOATER_OVERSHOOT_MAX * overshoot) / (overshoot + FLOATER_OVERSHOOT_MAX)
}

export function clampFloaterLeft(left: number, width: number, stripLeft: number, stripRight: number) {
  const stripWidth = stripRight - stripLeft
  if (width >= stripWidth) return stripLeft

  const maxLeft = stripRight - width
  if (left > maxLeft) return maxLeft + easeOvershoot(left - maxLeft)
  if (left < stripLeft) return stripLeft - easeOvershoot(stripLeft - left)

  return left
}

export function autoscrollSpeed(pointerX: number, containerLeft: number, containerRight: number) {
  const leftEdge = containerLeft + AUTOSCROLL_EDGE
  const rightEdge = containerRight - AUTOSCROLL_EDGE

  if (pointerX < leftEdge) {
    const depth = (leftEdge - pointerX) / AUTOSCROLL_EDGE
    return -Math.ceil(AUTOSCROLL_MAX_SPEED * Math.min(depth, 1))
  }

  if (pointerX > rightEdge) {
    const depth = (pointerX - rightEdge) / AUTOSCROLL_EDGE
    return Math.ceil(AUTOSCROLL_MAX_SPEED * Math.min(depth, 1))
  }

  return 0
}

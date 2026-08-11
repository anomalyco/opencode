import type { TabPosition } from "../config"

export const SESSION_SIDEBAR_WIDTH = 42
const SESSION_CONTENT_MIN_WIDTH = 44

export function sessionTabsFitVertically(total: number) {
  return total >= SESSION_SIDEBAR_WIDTH + SESSION_CONTENT_MIN_WIDTH
}

export function effectiveSessionTabPosition(position: TabPosition, total: number): TabPosition {
  if ((position === "left" || position === "right") && !sessionTabsFitVertically(total)) return "top"
  return position
}

export function sessionTabSidebarWidth(position: TabPosition, total: number) {
  const effective = effectiveSessionTabPosition(position, total)
  if (effective === "left" || effective === "right") return SESSION_SIDEBAR_WIDTH
  return 0
}

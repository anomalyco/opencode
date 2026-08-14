export const SESSION_SIDEBAR_WIDTH = 42
export const SESSION_SIDEBAR_MIN_WIDTH = 24
export const SESSION_SIDEBAR_MAX_WIDTH = 72
const SESSION_CONTENT_MIN_WIDTH = 44

export function sessionTabsFitVertically(total: number, width = SESSION_SIDEBAR_WIDTH) {
  return total >= width + SESSION_CONTENT_MIN_WIDTH
}

export function clampSessionTabsWidth(width: number, total: number) {
  return Math.max(
    SESSION_SIDEBAR_MIN_WIDTH,
    Math.min(width, SESSION_SIDEBAR_MAX_WIDTH, total - SESSION_CONTENT_MIN_WIDTH),
  )
}

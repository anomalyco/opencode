export const SESSION_SIDEBAR_WIDTH = 42
const SESSION_CONTENT_MIN_WIDTH = 44

export function sessionTabsFitVertically(total: number) {
  return total >= SESSION_SIDEBAR_WIDTH + SESSION_CONTENT_MIN_WIDTH
}

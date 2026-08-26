export function getLastActiveUrl(windowID: string) {
  if (typeof localStorage !== "object") return "/"
  try {
    return acceptedLastActiveUrl(localStorage.getItem(windowLastActiveUrlKey(windowID)))
  } catch {
    return "/"
  }
}

export function setLastActiveUrl(windowID: string, value: string) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(windowLastActiveUrlKey(windowID), value)
  } catch {}
}

export function acceptedLastActiveUrl(value: string | null | undefined) {
  if (value === "/") return value
  const path = value?.split(/[?#]/, 1)[0]
  if (path === "/new-session" || path === "/settings") return value ?? "/"
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(path ?? "")) return value ?? "/"
  return "/"
}

function windowLastActiveUrlKey(windowID: string) {
  return `opencode.desktop.window.${windowID}.last-active-url`
}

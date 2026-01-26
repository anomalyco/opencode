// Tracks page visibility state for detecting iOS backgrounding scenarios
// Used to suppress error toasts that occur due to background network disconnects

let lastHiddenAt = 0
let lastVisibleAt = Date.now()

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = Date.now()
    } else {
      lastVisibleAt = Date.now()
    }
  })
}

/** Returns true if the page was recently backgrounded (within the given threshold in ms) */
export function wasRecentlyBackgrounded(thresholdMs = 5000): boolean {
  if (!lastHiddenAt) return false
  const timeSinceVisible = Date.now() - lastVisibleAt
  return timeSinceVisible < thresholdMs && lastHiddenAt > 0
}

/** Returns the timestamp when the page was last hidden, or 0 if never */
export function getLastHiddenAt(): number {
  return lastHiddenAt
}

/** Returns true if the page is currently hidden */
export function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden"
}

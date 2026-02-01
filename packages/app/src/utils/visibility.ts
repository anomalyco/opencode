// Tracks page visibility state for detecting iOS backgrounding scenarios
// Used to suppress error toasts that occur due to background network disconnects

let lastHidden = 0
let lastVisible = Date.now()

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") lastHidden = Date.now()
    else lastVisible = Date.now()
  })
}

/** Returns true if the page was recently backgrounded (within threshold ms) */
export function wasRecentlyBackgrounded(threshold = 5000): boolean {
  return lastHidden > 0 && Date.now() - lastVisible < threshold
}

/** Returns true if page was hidden for at least `duration` ms before becoming visible */
export function wasHiddenFor(duration: number): boolean {
  return lastHidden > 0 && lastVisible - lastHidden > duration
}

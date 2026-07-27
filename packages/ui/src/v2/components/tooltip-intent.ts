const OPEN_DELAY = 1_000

// Kobalte warms every tooltip globally. Keep intent previews isolated so opening
// a model picker never inherits warm state from an unrelated tooltip.
let warm = false
let reset: ReturnType<typeof setTimeout> | undefined

export function openTooltipIntent(open: () => void) {
  clearTimeout(reset)
  reset = undefined
  if (warm) {
    open()
    return
  }
  const timer = setTimeout(() => {
    warm = true
    open()
  }, OPEN_DELAY)
  return () => clearTimeout(timer)
}

export function closeTooltipIntent() {
  clearTimeout(reset)
  // Adjacent triggers enter before the next task; leaving the group does not.
  reset = setTimeout(() => {
    warm = false
    reset = undefined
  })
}

export function resetTooltipIntent() {
  clearTimeout(reset)
  reset = undefined
  warm = false
}

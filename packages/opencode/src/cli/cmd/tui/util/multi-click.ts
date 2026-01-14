import { createSignal, type Accessor } from "solid-js"

interface ClickState {
  count: number
  lastClickTime: number
  x: number
  y: number
}

export function createMultiClickDetector(
  onDoubleClick: (x: number, y: number) => void,
  onTripleClick: (x: number, y: number) => void,
  clickTimeout: number = 500,
) {
  const [clickState, setClickState] = createSignal<ClickState>({
    count: 0,
    lastClickTime: 0,
    x: 0,
    y: 0,
  })

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  return (x: number, y: number) => {
    const now = Date.now()
    const currentState = clickState() // Read state once to avoid consistency issues
    const timeSinceLastClick = now - currentState.lastClickTime
    const positionTolerance = 5 // pixels

    // Check if this is part of a multi-click sequence
    const isSamePosition =
      Math.abs(x - currentState.x) < positionTolerance && Math.abs(y - currentState.y) < positionTolerance
    const isWithinTimeout = timeSinceLastClick < clickTimeout

    if (isSamePosition && isWithinTimeout) {
      // Increment click count
      const newCount = currentState.count + 1
      setClickState({
        count: newCount,
        lastClickTime: now,
        x,
        y,
      })

      // Clear existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // Trigger appropriate action
      if (newCount === 2) {
        onDoubleClick(x, y)
      } else if (newCount === 3) {
        onTripleClick(x, y)
      }

      // Set new timeout to reset count
      timeoutId = setTimeout(() => {
        setClickState((prev) => ({ ...prev, count: 0 }))
        timeoutId = undefined
      }, clickTimeout)
    } else {
      // Start new click sequence
      setClickState({
        count: 1,
        lastClickTime: now,
        x,
        y,
      })

      // Set timeout to reset count if no additional clicks
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        setClickState((prev) => ({ ...prev, count: 0 }))
        timeoutId = undefined
      }, clickTimeout)
    }
  }
}

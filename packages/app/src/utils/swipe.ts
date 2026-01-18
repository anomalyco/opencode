import { createSignal, Accessor } from "solid-js"

export interface SwipeState {
  /** Current X offset during swipe */
  x: Accessor<number>
  /** Whether a swipe is in progress */
  swiping: Accessor<boolean>
  /** Whether swipe threshold was reached */
  triggered: Accessor<boolean>
}

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: () => void
}

export interface SwipeOptions {
  /** Swipe threshold in pixels to trigger action */
  threshold?: number
  /** Direction of swipe: 'left' or 'right' */
  direction?: "left" | "right"
  /** Callback when swipe threshold is reached */
  onSwipe?: () => void
  /** Whether swipe is enabled */
  enabled?: boolean
}

const DEFAULT_THRESHOLD = 80

/**
 * Creates swipe gesture handlers for touch-based swipe-to-action UI.
 *
 * Usage:
 * ```tsx
 * const { state, handlers } = createSwipeHandlers({
 *   direction: 'left',
 *   threshold: 80,
 *   onSwipe: () => archiveItem()
 * })
 *
 * <div
 *   style={{ transform: `translateX(${state.x()}px)` }}
 *   onTouchStart={handlers.onTouchStart}
 *   onTouchMove={handlers.onTouchMove}
 *   onTouchEnd={handlers.onTouchEnd}
 * >
 *   Content
 * </div>
 * ```
 */
export function createSwipeHandlers(options: SwipeOptions = {}): {
  state: SwipeState
  handlers: SwipeHandlers
} {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const direction = options.direction ?? "left"
  const enabled = options.enabled ?? true

  const [x, setX] = createSignal(0)
  const [swiping, setSwiping] = createSignal(false)
  const [triggered, setTriggered] = createSignal(false)

  let touchStartX = 0
  let touchStartY = 0

  const onTouchStart = (e: TouchEvent) => {
    if (!enabled) return
    touchStartX = e.touches[0].clientX
    touchStartY = e.touches[0].clientY
    setSwiping(true)
    setTriggered(false)
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!enabled || !swiping()) return

    const deltaX = e.touches[0].clientX - touchStartX
    const deltaY = e.touches[0].clientY - touchStartY

    // Only handle horizontal swipes (avoid interfering with scroll)
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return

    // Check direction
    const isCorrectDirection = direction === "left" ? deltaX < 0 : deltaX > 0
    if (!isCorrectDirection) {
      setX(0)
      return
    }

    e.preventDefault()

    // Clamp the swipe distance
    const maxSwipe = threshold + 20
    const clampedX = direction === "left" ? Math.max(deltaX, -maxSwipe) : Math.min(deltaX, maxSwipe)

    setX(clampedX)
  }

  const onTouchEnd = () => {
    if (!enabled) return

    const currentX = Math.abs(x())
    if (currentX >= threshold) {
      setTriggered(true)
      options.onSwipe?.()
    }

    setX(0)
    setSwiping(false)
  }

  return {
    state: { x, swiping, triggered },
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  }
}

/**
 * Determines if a touch movement is primarily horizontal.
 * Used to distinguish swipe gestures from scroll gestures.
 */
export function isHorizontalSwipe(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > Math.abs(deltaY)
}

/**
 * Calculates the clamped swipe offset.
 */
export function clampSwipeOffset(delta: number, threshold: number, direction: "left" | "right"): number {
  const maxSwipe = threshold + 20
  if (direction === "left") {
    return Math.max(Math.min(delta, 0), -maxSwipe)
  }
  return Math.min(Math.max(delta, 0), maxSwipe)
}

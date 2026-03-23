import { createSignal, onCleanup } from "solid-js"

type LongPressOptions = {
  delay?: number
  onLongPress: () => void
  onTouchStart?: () => void
  onTouchEnd?: () => void
}

export function useLongPress(options: LongPressOptions) {
  const { delay = 500, onLongPress, onTouchStart, onTouchEnd } = options
  const [isLongPress, setIsLongPress] = createSignal(false)

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let startPos = { x: 0, y: 0 }

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0]
    startPos = { x: touch.clientX, y: touch.clientY }

    onTouchStart?.()

    timeoutId = setTimeout(() => {
      setIsLongPress(true)
      onLongPress()
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, delay)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!timeoutId) return

    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - startPos.x)
    const dy = Math.abs(touch.clientY - startPos.y)

    if (dx > 10 || dy > 10) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  const handleTouchEnd = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    onTouchEnd?.()
    setIsLongPress(false)
  }

  const bind = {
    ontouchstart: handleTouchStart,
    ontouchmove: handleTouchMove,
    ontouchend: handleTouchEnd,
  }

  onCleanup(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })

  return {
    isLongPress,
    bind,
  }
}

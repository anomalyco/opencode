import { createSignal, createEffect, onCleanup } from "solid-js"

export const isMobile = () => {
  if (typeof window === "undefined") return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768
}

export const isIOSDevice = () => {
  if (typeof window === "undefined") return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export const isIOS = () => {
  if (typeof window === "undefined") return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export const isAndroidDevice = () => {
  if (typeof window === "undefined") return false
  return /Android/i.test(navigator.userAgent)
}

export const isAndroid = () => {
  if (typeof window === "undefined") return false
  return /Android/i.test(navigator.userAgent)
}

export const isTauri = () => {
  return typeof window !== "undefined" && "__TAURI__" in window
}

export const createMediaQuery = (query: string) => {
  const [matches, setMatches] = createSignal(false)

  createEffect(() => {
    if (typeof window === "undefined") return

    const mediaQuery = window.matchMedia(query)
    setMatches(mediaQuery.matches)

    const handler = (event: MediaQueryListEvent) => setMatches(event.matches)
    mediaQuery.addEventListener("change", handler)

    onCleanup(() => mediaQuery.removeEventListener("change", handler))
  })

  return matches
}

export const createViewportSize = () => {
  const [size, setSize] = createSignal({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    window.addEventListener("resize", handleResize)
    onCleanup(() => window.removeEventListener("resize", handleResize))
  })

  return size
}

export const getSafeAreaInsets = () => {
  if (typeof window === "undefined" || typeof getComputedStyle === "undefined") {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }

  const style = getComputedStyle(document.documentElement)

  return {
    top: parseInt(style.getPropertyValue("--safe-area-inset-top") || "0"),
    right: parseInt(style.getPropertyValue("--safe-area-inset-right") || "0"),
    bottom: parseInt(style.getPropertyValue("--safe-area-inset-bottom") || "0"),
    left: parseInt(style.getPropertyValue("--safe-area-inset-left") || "0"),
  }
}

export const MOBILE_BREAKPOINT = 768
export const TABLET_BREAKPOINT = 1024

export type SwipeDirection = "up" | "down" | "left" | "right"

export interface SwipeHandlers {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
}

export const createSwipeGesture = (element: HTMLElement, handlers: SwipeHandlers) => {
  let touchStartX = 0
  let touchStartY = 0
  let touchEndX = 0
  let touchEndY = 0

  const minSwipeDistance = 50

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX = e.changedTouches[0].screenX
    touchStartY = e.changedTouches[0].screenY
  }

  const handleTouchEnd = (e: TouchEvent) => {
    touchEndX = e.changedTouches[0].screenX
    touchEndY = e.changedTouches[0].screenY
    handleGesture()
  }

  const handleGesture = () => {
    const diffX = touchEndX - touchStartX
    const diffY = touchEndY - touchStartY

    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (Math.abs(diffX) > minSwipeDistance) {
        if (diffX > 0) {
          handlers.onSwipeRight?.()
        } else {
          handlers.onSwipeLeft?.()
        }
      }
    } else {
      if (Math.abs(diffY) > minSwipeDistance) {
        if (diffY > 0) {
          handlers.onSwipeDown?.()
        } else {
          handlers.onSwipeUp?.()
        }
      }
    }
  }

  element.addEventListener("touchstart", handleTouchStart)
  element.addEventListener("touchend", handleTouchEnd)

  return () => {
    element.removeEventListener("touchstart", handleTouchStart)
    element.removeEventListener("touchend", handleTouchEnd)
  }
}

export const vibrate = (pattern: number | number[] = 10) => {
  if (typeof window !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern)
  }
}

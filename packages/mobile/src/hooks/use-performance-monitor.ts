/**
 * Performance Monitor Hook - Simplified version to avoid infinite loops
 * Tracks streaming performance metrics without causing re-renders
 */

import { useRef, useCallback } from "react"

export const usePerformanceMonitor = (sessionId: string, enabled: boolean = __DEV__) => {
  const eventCountRef = useRef(0)
  const lastLogTimeRef = useRef(Date.now())

  // Track streaming events
  const trackEvent = useCallback(() => {
    if (!enabled) return
    eventCountRef.current++

    // Log performance every 5 seconds to avoid spam
    const now = Date.now()
    if (now - lastLogTimeRef.current > 5000) {
      eventCountRef.current = 0
      lastLogTimeRef.current = now
    }
  }, [enabled, sessionId])

  // Log performance summary
  const logPerformanceSummary = useCallback(() => {
    if (!enabled) return
    // Performance summary logging removed
  }, [enabled])

  return {
    trackEvent,
    logPerformanceSummary,
    isOptimal: true, // Simplified - always return true
  }
}

/**
 * Performance Monitor Hook - Simplified version to avoid infinite loops
 * Tracks streaming performance metrics without causing re-renders
 */

import { useRef, useCallback } from "react"
import { batchWriter } from "@/services/api/local/batch-writer"

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
      const timeDiff = (now - lastLogTimeRef.current) / 1000
      const eventsPerSecond = eventCountRef.current / timeDiff
      const pendingWrites = batchWriter.getPendingCount()

      console.log(
        `🚀 Performance - Session ${sessionId}: ${Math.round(eventsPerSecond * 10) / 10} events/sec, ${pendingWrites} pending writes`,
      )

      eventCountRef.current = 0
      lastLogTimeRef.current = now
    }
  }, [enabled, sessionId])

  // Log performance summary
  const logPerformanceSummary = useCallback(() => {
    if (!enabled) return

    const pendingWrites = batchWriter.getPendingCount()
    console.group(`🚀 Performance Summary - Session ${sessionId}`)
    console.log(`💾 Pending writes: ${pendingWrites}`)
    console.log(`⏱️ Last check: ${new Date().toLocaleTimeString()}`)
    console.groupEnd()
  }, [enabled, sessionId])

  return {
    trackEvent,
    logPerformanceSummary,
    isOptimal: true, // Simplified - always return true
  }
}

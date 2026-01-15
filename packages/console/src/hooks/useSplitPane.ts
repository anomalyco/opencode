import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'af.splitRatio'
const DEFAULT_RATIO = 0.4 // 40% chat, 60% workspace
const MIN_LEFT_WIDTH = 280 // Minimum chat panel width in pixels
const MIN_RIGHT_WIDTH = 400 // Minimum workspace panel width in pixels

export function useSplitPane(containerRef: React.RefObject<HTMLElement | null>) {
  const [ratio, setRatioState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = parseFloat(stored)
        if (!isNaN(parsed) && parsed >= 0.1 && parsed <= 0.9) {
          return parsed
        }
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_RATIO
  })

  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const startRatioRef = useRef(ratio)

  // Persist ratio to localStorage
  const setRatio = useCallback((newRatio: number) => {
    const clampedRatio = Math.max(0.15, Math.min(0.85, newRatio))
    setRatioState(clampedRatio)
    try {
      localStorage.setItem(STORAGE_KEY, clampedRatio.toString())
    } catch {
      // Ignore storage errors
    }
  }, [])

  // Handle mouse down on splitter
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startXRef.current = e.clientX
    startRatioRef.current = ratio
  }, [ratio])

  // Handle mouse move during drag
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const containerWidth = containerRect.width
      const deltaX = e.clientX - startXRef.current
      const deltaRatio = deltaX / containerWidth

      // Calculate new left panel width in pixels
      const newRatio = startRatioRef.current + deltaRatio
      const leftWidth = newRatio * containerWidth
      const rightWidth = containerWidth - leftWidth

      // Apply min width constraints
      if (leftWidth >= MIN_LEFT_WIDTH && rightWidth >= MIN_RIGHT_WIDTH) {
        setRatio(newRatio)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    // Add cursor style to body during drag
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, containerRef, setRatio])

  // Reset to default ratio
  const resetRatio = useCallback(() => {
    setRatio(DEFAULT_RATIO)
  }, [setRatio])

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    resetRatio()
  }, [resetRatio])

  return {
    ratio,
    isDragging,
    handleMouseDown,
    handleDoubleClick,
    resetRatio,
    leftWidth: `${ratio * 100}%`,
    rightWidth: `${(1 - ratio) * 100}%`,
  }
}

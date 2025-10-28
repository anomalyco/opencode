import { Component, createMemo } from "solid-js"

interface ProgressCircleProps {
  percentage: number
  size?: number
  strokeWidth?: number
}

export const ProgressCircle: Component<ProgressCircleProps> = (props) => {
  // --- Set default values for props ---
  const size = () => props.size || 16
  const strokeWidth = () => props.strokeWidth || 3

  // --- Constants for SVG calculation ---
  const viewBoxSize = 16
  const center = viewBoxSize / 2
  const radius = () => center - strokeWidth() / 2
  const circumference = createMemo(() => 2 * Math.PI * radius())

  // --- Reactive Calculation for the progress offset ---
  const offset = createMemo(() => {
    const clampedPercentage = Math.max(0, Math.min(100, props.percentage || 0))
    const progress = clampedPercentage / 100
    return circumference() * (1 - progress)
  })

  return (
    <svg
      width={size()}
      height={size()}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      fill="none"
      class="transform -rotate-90"
    >
      <circle cx={center} cy={center} r={radius()} class="stroke-border-weak-base" stroke-width={strokeWidth()} />
      <circle
        cx={center}
        cy={center}
        r={radius()}
        class="stroke-border-active"
        stroke-width={strokeWidth()}
        stroke-dasharray={circumference().toString()}
        stroke-dashoffset={offset()}
        style={{ transition: "stroke-dashoffset 0.35s cubic-bezier(0.65, 0, 0.35, 1)" }}
      />
    </svg>
  )
}

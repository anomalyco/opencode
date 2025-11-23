import { type ComponentProps, createMemo, splitProps } from "solid-js"

export interface ProgressCircleProps extends Pick<ComponentProps<"svg">, "class" | "classList"> {
  percentage: number
  size?: number
  strokeWidth?: number
}

export function ProgressCircle(props: ProgressCircleProps) {
  const [split, rest] = splitProps(props, ["percentage", "size", "strokeWidth", "class", "classList"])

  const size = () => split.size || 16
  const strokeWidth = () => split.strokeWidth || 3

  const viewBoxSize = 16
  const center = viewBoxSize / 2
  const radius = () => center - strokeWidth() / 2
  const circumference = createMemo(() => 2 * Math.PI * radius())

  const offset = createMemo(() => {
    const clampedPercentage = Math.max(0, Math.min(100, split.percentage || 0))
    const progress = clampedPercentage / 100
    return circumference() * (1 - progress)
  })

  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      fill="none"
      data-component="progress-circle"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <circle
        cx={center}
        cy={center}
        r={radius()}
        data-slot="progress-circle-background"
        stroke-width={strokeWidth()}
      />
      <circle
        cx={center}
        cy={center}
        r={radius()}
        data-slot="progress-circle-progress"
        stroke-width={strokeWidth()}
        stroke-dasharray={circumference().toString()}
        stroke-dashoffset={offset()}
      />
    </svg>
  )
}

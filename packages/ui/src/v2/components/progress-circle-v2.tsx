import { type ComponentProps, createMemo, splitProps } from "solid-js"
import "./progress-circle-v2.css"

export interface ProgressCircleV2Props extends Pick<ComponentProps<"svg">, "class" | "classList"> {
  percentage: number
  size?: number
  strokeWidth?: number
}

export function ProgressCircleV2(props: ProgressCircleV2Props) {
  const [split, rest] = splitProps(props, ["percentage", "size", "strokeWidth", "class", "classList"])

  const size = () => split.size ?? 14
  const strokeWidth = () => split.strokeWidth ?? 1.5
  const viewBoxSize = 14
  const center = viewBoxSize / 2
  const radius = () => center - strokeWidth() / 2
  const circumference = createMemo(() => 2 * Math.PI * radius())
  const offset = createMemo(() => circumference() * (1 - Math.max(0, Math.min(100, split.percentage || 0)) / 100))

  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      fill="none"
      data-component="progress-circle-v2"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <circle
        cx={center}
        cy={center}
        r={radius()}
        data-slot="progress-circle-v2-background"
        stroke-width={strokeWidth()}
      />
      <circle
        cx={center}
        cy={center}
        r={radius()}
        data-slot="progress-circle-v2-progress"
        stroke-width={strokeWidth()}
        stroke-dasharray={circumference().toString()}
        stroke-dashoffset={offset()}
      />
    </svg>
  )
}

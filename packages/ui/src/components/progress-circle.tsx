import { type ComponentProps, createMemo, splitProps } from "solid-js"

export interface ProgressCircleProps extends Pick<ComponentProps<"svg">, "class" | "classList"> {
  percentage: number
  label?: number | string
  rounded?: boolean
  size?: number
  strokeWidth?: number
}

export function ProgressCircle(props: ProgressCircleProps) {
  const [split, rest] = splitProps(props, ["percentage", "label", "rounded", "size", "strokeWidth", "class", "classList"])

  const size = () => split.size || 16
  const strokeWidth = () => split.strokeWidth || 3

  const box = 16
  const center = box / 2
  const radius = () => center - strokeWidth() / 2
  const circumference = createMemo(() => 2 * Math.PI * radius())
  const font = () => Math.max(4, Math.round(box * 0.35))

  const offset = createMemo(() => {
    const pct = Math.max(0, Math.min(100, split.percentage || 0))
    return circumference() * (1 - pct / 100)
  })

  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      data-component="progress-circle"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <circle
        cx={center}
        cy={center}
        r={radius()}
        data-slot="progress-circle-background"
        stroke-width={strokeWidth()}
        transform={`rotate(-90 ${center} ${center})`}
        stroke-linecap={split.rounded ? "round" : "butt"}
      />
      <circle
        cx={center}
        cy={center}
        r={radius()}
        data-slot="progress-circle-progress"
        stroke-width={strokeWidth()}
        stroke-dasharray={circumference().toString()}
        stroke-dashoffset={offset()}
        transform={`rotate(-90 ${center} ${center})`}
        stroke-linecap={split.rounded ? "round" : "butt"}
      />
      <text
        x={center}
        y={center}
        data-slot="progress-circle-label"
        text-anchor="middle"
        dominant-baseline="central"
        font-size={font().toString()}
      >
        {split.label}
      </text>
    </svg>
  )
}

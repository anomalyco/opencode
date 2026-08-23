import { type ComponentProps, createMemo, Show, splitProps } from "solid-js"
import "./progress-circle.css"

export interface ProgressCircleProps extends Pick<ComponentProps<"svg">, "class" | "classList" | "style"> {
  percentage: number
  appearance?: "compact" | "indicator"
  size?: number
  strokeWidth?: number
}

export function ProgressCircle(props: ProgressCircleProps) {
  const [local, rest] = splitProps(props, ["percentage", "appearance", "size", "strokeWidth", "class", "classList"])

  const appearance = () => local.appearance ?? "compact"
  const viewBoxSize = () => (appearance() === "indicator" ? 16 : 14)
  const size = () => local.size ?? viewBoxSize()
  const strokeWidth = () => local.strokeWidth ?? (appearance() === "indicator" ? 3 : 1.5)
  const center = () => viewBoxSize() / 2
  const radius = () => center() - strokeWidth() / 2
  const circumference = createMemo(() => 2 * Math.PI * radius())
  const offset = createMemo(() => circumference() * (1 - Math.max(0, Math.min(100, local.percentage || 0)) / 100))

  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox={`0 0 ${viewBoxSize()} ${viewBoxSize()}`}
      fill="none"
      data-component="progress-circle"
      data-appearance={appearance()}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <circle
        cx={center()}
        cy={center()}
        r={radius()}
        data-slot="progress-circle-background"
        stroke-width={strokeWidth()}
      />
      <Show when={appearance() === "indicator"}>
        <circle
          cx={center()}
          cy={center()}
          r={radius()}
          data-slot="progress-circle-background-overlay"
          stroke-width={strokeWidth()}
        />
      </Show>
      <circle
        cx={center()}
        cy={center()}
        r={radius()}
        data-slot="progress-circle-progress"
        stroke-width={strokeWidth()}
        stroke-dasharray={circumference().toString()}
        stroke-dashoffset={offset()}
      />
    </svg>
  )
}

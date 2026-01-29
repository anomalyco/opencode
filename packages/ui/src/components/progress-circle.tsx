import { type ComponentProps, splitProps } from "solid-js"

export interface ProgressCircleProps extends Pick<ComponentProps<"svg">, "class" | "classList"> {
  percentage: number
  size?: number
  strokeWidth?: number
}

export function ProgressCircle(props: ProgressCircleProps) {
  const [split, rest] = splitProps(props, ["percentage", "size", "strokeWidth", "class", "classList"])

  const size = () => split.size || 18
  const r = 7

  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox="0 0 18 18"
      fill="none"
      data-component="progress-circle"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <circle cx="9" cy="9" r="7.75" stroke="currentColor" stroke-width="1.5" />
      <path
        opacity="0.5"
        d={(() => {
          const pct = Math.min(100, Math.max(0, split.percentage))
          const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2
          const x = 9 + r * Math.cos(angle)
          const y = 9 + r * Math.sin(angle)
          const largeArc = pct > 50 ? 1 : 0
          return `M9 2A${r} ${r} 0 ${largeArc} 1 ${x} ${y}L9 9Z`
        })()}
        fill="currentColor"
      />
    </svg>
  )
}

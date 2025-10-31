import { RGBA } from "@opentui/core"
import { useTimeline } from "@opentui/solid"
import { createMemo, createSignal } from "solid-js"

export type ShimmerProps = {
  text: string
  color: RGBA
}

const DURATION = 2_500

export function Shimmer(props: ShimmerProps) {
  const timeline = useTimeline({
    duration: DURATION,
    loop: true,
  })
  const characters = props.text.split("")
  const color = props.color

  const shimmerSignals = characters.map((_, i) => {
    const [shimmer, setShimmer] = createSignal(0.4)
    const target = {
      shimmer: shimmer(),
      setShimmer,
    }

    timeline!.add(
      target,
      {
        shimmer: 1,
        duration: DURATION / (props.text.length + 1),
        ease: "linear",
        alternate: true,
        loop: 2,
        onUpdate: () => {
          target.setShimmer(target.shimmer)
        },
      },
      (i * (DURATION / (props.text.length + 1))) / 2,
    )

    return shimmer
  })

  return (
    <text>
      {(() => {
        return characters.map((ch, i) => {
          const shimmer = shimmerSignals[i]
          const fg = RGBA.fromInts(color.r * 255, color.g * 255, color.b * 255, shimmer() * 255)
          return <span style={{ fg }}>{ch}</span>
        })
      })()}
    </text>
  )
}

import { RGBA } from "@opentui/core"
import { useTimeline } from "@opentui/solid"
import { createMemo, createSignal } from "solid-js"

export type ShimmerProps = {
  text: string
  color: RGBA
}

const DURATION = 2_500
const THROTTLE_MS = 100 // Update max 10fps instead of 60fps

export function Shimmer(props: ShimmerProps) {
  const timeline = useTimeline({
    duration: DURATION,
    loop: true,
  })
  const characters = props.text.split("")
  const color = props.color

  // Single throttled update signal instead of per-character
  const [lastUpdate, setLastUpdate] = createSignal(Date.now())

  const shimmerSignals = characters.map((_, i) => {
    const [shimmer, setShimmer] = createSignal(0.4)
    const target = {
      shimmer: shimmer(),
      setShimmer,
    }

    let lastThrottledUpdate = 0
    timeline!.add(
      target,
      {
        shimmer: 1,
        duration: DURATION / (props.text.length + 1),
        ease: "linear",
        alternate: true,
        loop: 2,
        onUpdate: () => {
          // Throttle updates to reduce from 60fps to ~10fps
          const now = Date.now()
          if (now - lastThrottledUpdate >= THROTTLE_MS) {
            target.setShimmer(target.shimmer)
            lastThrottledUpdate = now
            setLastUpdate(now) // Trigger single reactive update
          }
        },
      },
      (i * (DURATION / (props.text.length + 1))) / 2,
    )

    return shimmer
  })

  // Memoize the expensive color calculations
  const memoizedChars = createMemo(() => {
    lastUpdate() // Track the throttled updates
    return characters.map((ch, i) => {
      const shimmer = shimmerSignals[i]
      const fg = RGBA.fromInts(color.r * 255, color.g * 255, color.b * 255, shimmer() * 255)
      return { ch, fg }
    })
  })

  return (
    <text>
      {memoizedChars().map(({ ch, fg }) => (
        <span style={{ fg }}>{ch}</span>
      ))}
    </text>
  )
}

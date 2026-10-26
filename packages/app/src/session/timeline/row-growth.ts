import { motionTuning } from "@opencode/ui/motion-tuning"

// Like the iOS transcript: rows that move or grow spring to their new places on this spring. A slow, long spring reads
// calmly while a reply streams in; a reply a screen or more long fades in instead of catching up.
export const growthSpring = motionTuning.spring("timeline.growth", {
  label: "Row growth & return",
  group: "Timeline",
  shipped: "calm",
  presets: {
    snappy: { duration: 0.32, bounce: 0 },
    smooth: { duration: 0.55, bounce: 0 },
    calm: { duration: 1, bounce: 0 },
  },
})

// With reduced motion, an arriving row only fades in where it rests.
export const arrivalFade = motionTuning.number("timeline.arrival-fade", {
  label: "Reduced arrival fade",
  group: "Timeline",
  value: 0.16,
  min: 0,
  max: 1,
  step: 0.01,
  unit: "s",
  time: "duration",
})

// The soft edge a growing row's new part reveals under. A streaming row's newest line uses a shorter one, so it gains
// its height sooner and the mask shows for less time.
export const softEdge = 28

export const streamingEdge = 12

const ease = (t: number) => t * t * (3 - 2 * t)

const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

// Like the iOS WorkingHandoffPose: Working blurs and shrinks out as the reply's copy button sharpens in.
export function workingHandoffPose(handoff: number, handsOffToCopy = true, reduceMotion = false) {
  const m = Math.min(1, Math.max(0, handoff))

  if (m <= 0)
    return {
      indicatorOpacity: 1,
      indicatorBlur: 0,
      indicatorScale: 1,
      copyOpacity: 0,
      copyBlur: 6,
      copyScale: 0.6,
    }

  if (reduceMotion)
    return {
      indicatorOpacity: 1 - m,
      indicatorBlur: 0,
      indicatorScale: 1,
      copyOpacity: handsOffToCopy ? m : 0,
      copyBlur: 0,
      copyScale: 1,
    }

  if (!handsOffToCopy) {
    const out = ease(m)

    return {
      indicatorOpacity: 1 - out,
      indicatorBlur: 4 * m,
      indicatorScale: 1 - 0.04 * out,
      copyOpacity: 0,
      copyBlur: 6,
      copyScale: 0.6,
    }
  }

  const out = Math.min(1, Math.max(0, m / 0.7))
  const into = Math.min(1, Math.max(0, (m - 0.25) / 0.75))
  const easedOut = ease(out)
  const easedInto = easeOut(into)

  return {
    indicatorOpacity: 1 - easedOut,
    indicatorBlur: 6 * out,
    indicatorScale: 1 - 0.5 * easedOut,
    copyOpacity: easedInto,
    copyBlur: 6 * (1 - into),
    copyScale: 0.6 + 0.4 * easedInto,
  }
}

// Like the iOS handoff: Working blurs and shrinks out of `indicator` as the copy button in `copy` sharpens in, baked into
// keyframes once.
export function workingHandoff(
  indicator: HTMLElement | null | undefined,
  copy: HTMLElement | null | undefined,
  reduced: boolean,
) {
  const samples = 24
  const poses = Array.from({ length: samples + 1 }, (_, index) => workingHandoffPose(index / samples, !!copy, reduced))
  const timing = { duration: 340 * motionTuning.timeScale(), easing: "linear" }

  const frame = (opacity: number, blur: number, scale: number) => ({
    opacity,
    filter: `blur(${Math.round(blur * 100) / 100}px)`,
    transform: `scale(${Math.round(scale * 1000) / 1000})`,
  })

  if (copy) copy.style.transformOrigin = "left center"

  return [
    indicator?.animate(
      poses.map((pose) => frame(pose.indicatorOpacity, pose.indicatorBlur, pose.indicatorScale)),
      { ...timing, fill: "forwards" },
    ),
    copy?.animate(
      poses.map((pose) => frame(pose.copyOpacity, pose.copyBlur, pose.copyScale)),
      timing,
    ),
  ].filter((animation) => animation !== undefined)
}

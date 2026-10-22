import { batch } from "solid-js"
import { frameLoop, Spring } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"

// Like the iOS transcript: while the timeline follows its end, a row's displayed height springs to its measured height.
export const growthSpring = motionTuning.spring("timeline.growth", {
  label: "Row growth, return & send flight",
  group: "Experiments",
  card: "Timeline",
  presets: {
    snappy: { duration: 0.32, bounce: 0 },
    smooth: { duration: 0.42, bounce: 0 },
    calm: { duration: 0.55, bounce: 0 },
  },
})

const grid = (value: number) => Math.round(value * 64) / 64

const softEdge = 28

// How a streaming row's newest line lands, an experiment for Kit to pick from. Feather, as shipped, grows each line in
// under a long soft mask; Fast feather gains each line's height sooner so the mask shows for less time; No mask lets the
// line draw whole while the row's height, and so the scroll, still glides; Word fade does the same with its new words
// fading in place.
export const streamingEdge = motionTuning.choice("timeline.edge", {
  label: "Streaming edge",
  group: "Experiments",
  card: "Timeline",
  value: "feather",
  labels: { feather: "Feather", fast: "Fast feather", whole: "No mask", fade: "Word fade" },
})

type Edge = { catchUp: number; feather: number; floor: number; fadeOut: number; spring: number; clip: boolean }

const feather = { catchUp: 1, feather: softEdge, floor: 18, fadeOut: 1.8, spring: 1, clip: true }
const unmasked = { catchUp: 1, feather: 0, floor: 0, fadeOut: softEdge, spring: 1, clip: false }
const edges = {
  feather,
  fast: { catchUp: 2.4, feather: 12, floor: 6, fadeOut: 4, spring: 0.55, clip: true },
  whole: unmasked,
  fade: unmasked,
} satisfies Record<ReturnType<typeof streamingEdge>, Edge>

export function streamingEdgeFor(style = streamingEdge()): Edge {
  return edges[style]
}

// The markdown's word fade follows the choice too: No mask shows new words at once and Word fade fades them longer.
if (typeof document !== "undefined") {
  const mark = () => (document.documentElement.dataset.streamingEdge = streamingEdge())
  mark()
  motionTuning.subscribe(mark)
}

export const workingHandoffDuration = 0.34

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

export type CoupledGap = { key: string; base: number; extra: number }

export type Coupled =
  | { key: string; base: number; extra: number; moveDistance?: number }
  | { gaps: CoupledGap[]; moveDistance: number }

type NormalizedCoupled = { gaps: CoupledGap[]; moveDistance: number }

function normalizeCoupled(coupled: Coupled | undefined): NormalizedCoupled | undefined {
  if (!coupled) return undefined
  if ("gaps" in coupled) return coupled
  return {
    gaps: [{ key: coupled.key, base: coupled.base, extra: coupled.extra }],
    moveDistance: coupled.moveDistance ?? 0,
  }
}

type Growth = {
  value: number
  target: number
  opaque: number
  maskValue: number
  maskPx: number
  freshRow: boolean
  streaming: boolean
  cruiseStep: number
  /** The row's backlog, averaged over about a third of a second: how far a stream runs ahead of its growth. */
  unclipped?: boolean
  entering: boolean
  enterSpan: number
  enterProgress: number
  enter?: () => void
  coupled?: NormalizedCoupled
  entrance?: Spring
}

/**
 * Rows whose displayed height eases toward their measured height, and a gap left by a row near the end that closes on
 * the same spring. Each frame `measure` reads layout before any writes, `resize` commits a displayed height and returns
 * the row's clipping wrapper (false once the row has left the list), `below` tells whether a row is below the gap, and
 * `settle` runs once after the sizes with how far the rows still have to grow and how much of the gap is still open.
 */
export function createRowGrowth(input: {
  measure: () => void
  resize: (key: string, size: number) => HTMLElement | false | undefined
  below: (key: string) => boolean
  foldRoom?: () => number
  movesWorking?: (key: string) => boolean
  coupledDistance?: (key: string, originKey: string, shown: number) => number | undefined
  settle: (state: { pending: number; held: number }) => void
}) {
  const growths = new Map<string, Growth>()
  let spring: Spring | undefined
  let fresh = false
  let lastTake = 0
  let held: Spring | undefined
  let closing = false
  let quiet = 0
  let stop: (() => void) | undefined

  const advance = (dt: number) => {
    if (!spring || !growths.size) {
      spring = undefined
      lastTake = 0
      return
    }
    const streamingRow = [...growths.values()].find((growth) => growth.streaming)
    const streamEdge = streamingRow ? streamingEdgeFor() : undefined
    const tuned = growthSpring()
    spring.tune(streamEdge ? { ...tuned, duration: tuned.duration * streamEdge.spring } : tuned)
    // Arrivals own their travel. Recompute the shared remainder from its rows instead of keeping a second ledger
    // that can retain an arrival's distance after that arrival has landed.
    const remaining = [...growths.values()].reduce(
      (sum, growth) =>
        sum +
        (growth.target > growth.value && !growth.streaming && !growth.coupled
          ? 0
          : Math.abs(growth.target - growth.value)),
      0,
    )
    spring.set(spring.value + remaining)
    const before = grid(spring.value)
    const beforeRaw = spring.value
    const nextValue = spring.step(dt)
    const target = spring.target
    // A growth bent toward a nearer target keeps its speed and would pass it, then come back: it lands there instead.
    const sharedDone = spring.resting || (target - before) * (target - nextValue) <= 0
    const rawBudget = sharedDone ? Infinity : Math.max(0, nextValue - beforeRaw)
    const scale = Math.max(1, motionTuning.timeScale())
    let stepped = false
    let consumed = 0

    growths.forEach((growth, key) => {
      const prevShown = grid(growth.value)
      const diff = growth.target - growth.value
      const rem = Math.abs(diff)
      if (rem <= 1e-4 && growth.entering) {
        const wrapper = input.resize(key, growth.target)
        if (wrapper) {
          paintEdge(wrapper, growth, 0)
          paintArrival(wrapper, growth, growth.target)
        }
        if (!growth.entering || !wrapper) growths.delete(key)
        return
      }
      const independent = diff > 0 && !growth.streaming && !growth.coupled
      if (stepped && diff >= 0 && !independent) {
        if (growth.coupled && growth.coupled.gaps.length > 0) {
          const shown = grid(growth.value)
          const ratio = Math.max(0, Math.min(1, 1 - shown / Math.max(1, growth.target)))
          const live = input.coupledDistance?.(key, growth.coupled.gaps[0]!.key, shown)
          if (live !== undefined) growth.coupled.moveDistance = live
          const wrapper = input.resize(key, shown)
          if (wrapper) paintCoupled(wrapper, growth.coupled.moveDistance * ratio)
        }
        return
      }
      const slowWorking = input.movesWorking?.(key) ?? false
      const edge = growth.streaming ? streamingEdgeFor() : edges.feather
      if (growth.freshRow) {
        growth.freshRow = false
        if (!independent) lastTake = 0
      }
      const coupled = growth.coupled
      if (coupled && coupled.gaps.length > 0) {
        const live = input.coupledDistance?.(key, coupled.gaps[0]!.key, prevShown)
        if (live !== undefined) coupled.moveDistance = live
      }
      const extraTotal = coupled ? coupled.gaps.reduce((sum, gap) => sum + gap.extra, 0) : 0
      const travel = coupled ? Math.max(0, coupled.moveDistance - extraTotal) : 0
      const travelFactor = coupled && growth.target > 0 ? Math.max(1, travel / growth.target) : 1
      const dtFactor = Math.max(0.75, Math.min(2.0, dt / (1 / 60)))
      const startStep = 1.875 / scale
      const fastCap = Math.min(16, 11.5 + Math.max(0, rem - 90) * 0.05)
      const baseCap = (slowWorking ? 7.5 : lastTake < 7.5 / scale ? 11.5 : fastCap) / scale
      const targetCap = growth.streaming
        ? rem <= 36
          ? Math.max(1.25 / scale, Math.min(baseCap, ((rem * 0.085 + 0.65) * edge.catchUp) / scale))
          : Math.min(baseCap, ((3.71 + (rem - 36) * 0.14) * edge.catchUp) / scale)
        : baseCap
      const rampUp =
        lastTake > 0
          ? Math.min(lastTake * 2.2, lastTake + (2.8 * Math.min(3, edge.catchUp) * dtFactor) / scale)
          : startStep
      const rampDown = lastTake > targetCap ? Math.max(targetCap, lastTake - (3.0 * dtFactor) / scale) : targetCap
      let maxTake = Math.max(
        growth.streaming && lastTake > 0 ? Math.min(targetCap, 1.15 / scale) : startStep,
        Math.min(rampDown, rampUp),
      )
      const heldRoom = held && input.below(key) ? grid(held.value) : 0
      if (!coupled && heldRoom > 1 / 64 && heldRoom < maxTake) {
        maxTake = heldRoom
        growth.freshRow = true
      }
      const room = input.foldRoom?.() ?? 0
      if (!coupled && room > 1 / 64 && room < maxTake) {
        maxTake = grid(room)
        growth.freshRow = true
      }
      // A complete arriving row follows the duration spring. Per-frame stream caps made a long sent prompt take
      // seconds to open at lower refresh rates, long after its flight had arrived.
      // Its own spring lets complete arrivals open together without inheriting another row's speed or backlog.
      const entrance = independent ? (growth.entrance ??= Spring.fromDuration(growth.value, tuned)) : undefined
      entrance?.tune(tuned).set(growth.target)
      const entranceValue = entrance?.step(dt)
      const done = entrance ? entrance.resting || entranceValue! >= growth.target : sharedDone
      const budget = entranceValue === undefined ? rawBudget : Math.max(0, entranceValue - growth.value)
      const rowMaxTake = independent ? Infinity : maxTake / travelFactor
      const take = rem <= 0 ? 0 : Math.min(rem, budget, done && rem <= rowMaxTake ? rem : rowMaxTake)
      if (!independent) {
        stepped ||= diff > 0
        consumed += take
        lastTake = take * travelFactor
      }
      const nextRowValue = rem <= 0 ? growth.value : growth.value + Math.sign(diff) * take
      const rowDone =
        (done && rem <= rowMaxTake) ||
        (growth.target - prevShown) * (growth.target - nextRowValue) <= 0 ||
        Math.abs(growth.target - nextRowValue) * travelFactor <= (coupled ? 0.5 : 1e-4)
      growth.value = rowDone ? growth.target : nextRowValue
      const shown = rowDone ? growth.target : grid(growth.value)
      if (!rowDone && take <= 0 && !growth.entering) return

      const enter = growth.enter
      if (enter) {
        growth.enter = undefined
        enter()
      }
      if (coupled) {
        const ratio = rowDone ? 0 : Math.max(0, Math.min(1, 1 - shown / Math.max(1, growth.target)))
        coupled.gaps.forEach((gap) => {
          const cWrapper = input.resize(gap.key, rowDone ? gap.base : grid(gap.base + gap.extra * ratio))
          if (rowDone && cWrapper) clearWrapper(cWrapper)
        })
      }
      const wrapper = input.resize(key, shown)
      if (coupled) {
        if (rowDone || wrapper === false) {
          if (wrapper === false) {
            coupled.gaps.forEach((gap) => {
              const cWrapper = input.resize(gap.key, gap.base)
              if (cWrapper) clearWrapper(cWrapper)
            })
          } else if (wrapper) {
            clearCoupled(wrapper)
          }
        } else {
          const ratio = Math.max(0, Math.min(1, 1 - shown / Math.max(1, growth.target)))
          if (coupled.gaps.length > 0) {
            const live = input.coupledDistance?.(key, coupled.gaps[0]!.key, shown)
            if (live !== undefined) coupled.moveDistance = live
          }
          if (wrapper) paintCoupled(wrapper, coupled.moveDistance * ratio)
        }
      }

      if (wrapper === false) {
        growths.delete(key)
      } else {
        if (wrapper) {
          if (!edge.clip && growth.streaming && !coupled) {
            // The line draws whole past the row's growing edge, over the gap below it.
            paintEdge(wrapper, growth, 0)
            growth.unclipped = !rowDone
            wrapper.style.overflow = rowDone ? "clip" : "visible"
          } else if (rowDone || growth.target <= shown || coupled) {
            paintEdge(wrapper, growth, 0)
          } else {
            const leftToGrow = Math.max(0, growth.target - shown)
            const wantFade = Math.min(edge.feather, Math.max(growth.streaming ? edge.floor : 0, leftToGrow * 1.5))
            growth.maskValue =
              wantFade >= growth.maskValue
                ? Math.min(wantFade, growth.maskValue + 5)
                : Math.max(wantFade, growth.maskValue - edge.fadeOut)
            paintEdge(wrapper, growth, Math.min(shown, growth.maskValue))
          }
          if (growth.entering) paintArrival(wrapper, growth, shown)
        }
        if (rowDone) {
          if (!independent && rem > take) consumed += rem - take
          if (!growth.entering || !wrapper) growths.delete(key)
        }
      }

      if (held && wrapper !== false && input.below(key))
        held.value = Math.max(0, held.value - Math.max(0, shown - prevShown))
    })

    if (spring) {
      spring.value = Math.min(spring.target, beforeRaw + consumed)
    }

    if (!growths.size) {
      spring = undefined
      lastTake = 0
    }
  }

  const settle = () => {
    let net = 0
    growths.forEach((growth) => {
      net += growth.target - grid(growth.value)
      if (growth.coupled) {
        const ratio = Math.max(0, Math.min(1, 1 - grid(growth.value) / Math.max(1, growth.target)))
        growth.coupled.gaps.forEach((gap) => {
          net -= grid(gap.extra * ratio)
        })
      }
    })
    input.settle({ pending: Math.max(0, grid(net)), held: held ? Math.max(0, grid(held.value)) : 0 })
  }

  const step = (dt: number) => {
    const stepDt = fresh ? 1 / 60 : Math.min(dt, 1 / 30)
    fresh = false
    batch(() => advance(stepDt))
    // A send's freed composer space closes alongside its arriving row. Only a streaming tail waits briefly, so pauses
    // between chunks do not repeatedly start and stop the gap.
    quiet = growths.size ? 0 : quiet + stepDt

    if (
      held &&
      (closing || quiet >= 0.12 || [...growths.values()].some((growth) => growth.entering && !growth.streaming))
    ) {
      closing = true
      held.tune(growthSpring())
      held.step(stepDt)
    }

    if (held?.resting) {
      held = undefined
      closing = false
    }

    settle()

    if (growths.size > 0 || held) return true
    stop = undefined

    return false
  }

  return {
    growing: () => growths.size > 0,
    entering: (key: string) => growths.get(key)?.entering === true,
    coupled: (key: string) => growths.get(key)?.coupled,
    shown: (key: string) => {
      const running = growths.get(key)
      return running ? grid(running.value) : undefined
    },
    targets: () => {
      const targets = new Map<string, number>()
      growths.forEach((growth, key) => {
        growth.coupled?.gaps.forEach((gap) => targets.set(gap.key, gap.base))
        targets.set(key, growth.target)
      })
      return targets
    },
    target: (key: string) => {
      const direct = growths.get(key)?.target
      if (direct !== undefined) return direct
      for (const growth of growths.values()) {
        const hit = growth.coupled?.gaps.find((gap) => gap.key === key)
        if (hit) return hit.base
      }
      return undefined
    },
    grow(key: string, from: number, to: number, enter?: (() => void) | boolean, coupled?: Coupled, streaming = false) {
      const entering = typeof enter === "boolean" ? enter : !!enter
      const onEnter = typeof enter === "function" ? enter : undefined
      const normalized = normalizeCoupled(coupled)
      const wasGrowing = growths.size > 0
      const running = growths.get(key)
      if (running) {
        if (!normalized && running.target > running.value && to <= running.value) {
          this.land(key, to)
          return
        }
        const oldRem = Math.abs(running.target - running.value)
        if (normalized) {
          running.value = from
          running.coupled = normalized
          running.entrance = undefined
        } else if (oldRem <= 1e-4 && !streaming && !running.streaming) {
          running.freshRow = true
        }
        // Completing the stream must not remove its catch-up cap while the displayed row is still behind.
        running.streaming ||= streaming
        if (running.streaming) running.entrance = undefined
        running.target = to
        if (onEnter && !running.enter) running.enter = onEnter
        if (entering) running.entering = true
        return
      }
      const rem = Math.abs(to - from)
      if (rem <= 1e-4) {
        onEnter?.()
        const wrapper = input.resize(key, to)
        if (wrapper) clearWrapper(wrapper)
        if (normalized) {
          normalized.gaps.forEach((gap) => {
            const cWrapper = input.resize(gap.key, gap.base)
            if (cWrapper) clearWrapper(cWrapper)
          })
        }
        return
      }
      growths.set(key, {
        value: from,
        target: to,
        opaque: Math.max(0, from),
        maskValue: streaming ? Math.min(16, streamingEdgeFor().feather) : Math.min(softEdge, rem),
        maskPx: 0,
        freshRow: true,
        streaming,
        cruiseStep: 0,
        entering: entering && from === 0,
        enterSpan: Math.min(28, Math.max(12, to)),
        enterProgress: 0,
        enter: onEnter,
        coupled: normalized,
      })
      if (!spring) spring = Spring.fromDuration(0, growthSpring())
      if (!wasGrowing) fresh = true
      stop ??= frameLoop.addMeasured(input.measure, step)
    },
    absorb(key: string, removed: number, base: number, to: number, enter?: (() => void) | boolean) {
      const running = growths.get(key)
      if (!running) {
        const from = base + removed
        if (Math.abs(to - from) <= 1e-4) {
          queueMicrotask(() => {
            if (typeof enter === "function") enter()
            this.land(key, to)
          })
          return
        }
        this.grow(key, from, to, enter)
        return
      }
      running.value += removed
      running.target = to
      const newRem = Math.abs(running.target - running.value)
      if (typeof enter === "function" && !running.enter) running.enter = enter
      if (newRem <= 1e-4) {
        queueMicrotask(() => this.land(key, to))
        return
      }
    },
    drop(key: string) {
      const running = growths.get(key)
      if (!running) return
      if (running.unclipped) {
        const wrapper = input.resize(key, running.target)
        if (wrapper) wrapper.style.overflow = "clip"
      }
      if (running.coupled) {
        running.coupled.gaps.forEach((gap) => {
          const cWrapper = input.resize(gap.key, gap.base)
          if (cWrapper) clearWrapper(cWrapper)
        })
      }
      growths.delete(key)
      if (!growths.size) {
        spring = undefined
        lastTake = 0
      }
    },
    // A coupled gap measured a new resting height (a run joining, say): it keeps its share of the glide on top of it.
    rebase(key: string, base: number) {
      const owner = [...growths.values()].find((growth) => growth.coupled?.gaps.some((gap) => gap.key === key))
      const gap = owner?.coupled?.gaps.find((item) => item.key === key)
      if (!owner || !gap) return false
      gap.base = base
      const ratio = Math.max(0, Math.min(1, 1 - grid(owner.value) / Math.max(1, owner.target)))
      input.resize(key, grid(base + gap.extra * ratio))
      return true
    },
    // The row leaves mid-glide: its coupled gaps keep their share of the room and close on their own growth.
    release(key: string) {
      const running = growths.get(key)
      if (!running?.coupled) return this.drop(key)
      const ratio = Math.max(0, Math.min(1, 1 - grid(running.value) / Math.max(1, running.target)))
      const gaps = running.coupled.gaps
      growths.delete(key)
      gaps.forEach((gap) => {
        const current = grid(gap.base + gap.extra * ratio)
        if (current - gap.base > 1 / 64) return this.grow(gap.key, current, gap.base)
        const wrapper = input.resize(gap.key, gap.base)
        if (wrapper) clearWrapper(wrapper)
      })
      if (!growths.size) {
        spring = undefined
        lastTake = 0
      }
    },
    hold(size: number) {
      held ??= Spring.fromDuration(0, growthSpring())
      held.tune(growthSpring())
      held.value += size
      held.set(0)
      stop ??= frameLoop.addMeasured(input.measure, step)
    },
    land(key: string, size: number) {
      const running = growths.get(key)
      if (running) {
        if (running.coupled) {
          running.coupled.gaps.forEach((gap) => {
            const cWrapper = input.resize(gap.key, gap.base)
            if (cWrapper) clearWrapper(cWrapper)
          })
        }
        growths.delete(key)
        if (!growths.size) {
          spring = undefined
          lastTake = 0
        }
      }
      const wrapper = input.resize(key, size)
      if (wrapper) clearWrapper(wrapper)
    },
    finish() {
      fresh = false
      lastTake = 0
      stop?.()
      stop = undefined
      spring = undefined
      held = undefined
      closing = false
      batch(() =>
        growths.forEach((growth, key) => {
          growth.enter?.()
          if (growth.coupled) {
            growth.coupled.gaps.forEach((gap) => {
              const cWrapper = input.resize(gap.key, gap.base)
              if (cWrapper) clearWrapper(cWrapper)
            })
          }
          const wrapper = input.resize(key, growth.target)
          if (wrapper) clearWrapper(wrapper)
        }),
      )
      growths.clear()
    },
  }
}

function paintEdge(wrapper: HTMLElement, growth: Growth | undefined, fade: number) {
  const px = fade < 1 ? 0 : Math.round(fade)
  if (growth) {
    if (growth.maskPx === px) return
    growth.maskPx = px
  }
  if (px === 0) return wrapper.style.removeProperty("mask-image")
  wrapper.style.setProperty(
    "mask-image",
    `linear-gradient(to bottom, #000 calc(100% - ${px}px), rgba(0, 0, 0, 0.72) calc(100% - ${Math.round(px * 0.62)}px), rgba(0, 0, 0, 0.28) calc(100% - ${Math.round(px * 0.28)}px), transparent)`,
  )
}

function paintArrival(wrapper: HTMLElement, growth: Growth, shown: number) {
  // Small gaps can land before reaching the entrance span; their fade must still finish and release the frame loop.
  const raw = shown >= growth.target ? 1 : Math.min(1, Math.max(0, shown / Math.max(1, growth.enterSpan)))
  growth.enterProgress = Math.min(growth.enterProgress + 0.34, Math.max(0.28, easeOut(raw)))
  const p = growth.enterProgress
  if (p >= 0.995) {
    growth.entering = false
    clearArrival(wrapper)
    return
  }
  wrapper.style.opacity = `${Math.round(p * 1000) / 1000}`
}

function clearArrival(wrapper: HTMLElement) {
  wrapper.style.removeProperty("opacity")
  wrapper.style.removeProperty("filter")
}

function paintCoupled(wrapper: HTMLElement, offset: number) {
  const px = grid(offset)
  const inner = wrapper.firstElementChild as HTMLElement | null
  if (!inner) return
  // Working rides above its growing row while it glides, so the row must not clip it.
  wrapper.style.overflow = "visible"
  if (px <= 1 / 64) {
    inner.style.removeProperty("transform")
    return
  }
  inner.style.transform = `translateY(${-px}px)`
}

function clearCoupled(wrapper: HTMLElement) {
  const inner = wrapper.firstElementChild as HTMLElement | null
  if (wrapper.style.overflow === "visible") wrapper.style.overflow = "clip"
  inner?.style.removeProperty("transform")
}

function clearWrapper(wrapper: HTMLElement) {
  paintEdge(wrapper, undefined, 0)
  clearArrival(wrapper)
  clearCoupled(wrapper)
}

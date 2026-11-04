import { octantGlyph } from "./subcell"
import type { Config } from "../config"

export type OneCellMotion = {
  frames: string[]
  interval: number
  levels?: number[]
  intro?: Pick<OneCellMotion, "frames" | "interval" | "levels">
  once?: boolean
  pace?: { initial: number; final: number; after: number; duration: number }
}

export function oneCellFrame(animation: OneCellMotion, elapsed: number) {
  const introDuration = animation.intro ? animation.intro.frames.length * animation.intro.interval : 0
  const intro = elapsed < introDuration
  const clip = intro ? animation.intro! : animation
  const pace = animation.pace
  const progress = pace ? Math.max(0, Math.min(1, (elapsed - pace.after) / pace.duration)) : 0
  // Integrate the changing rate so slowing down does not jump or restart the motion.
  const time = intro
    ? elapsed
    : !pace
      ? elapsed - introDuration
      : (elapsed - introDuration) * pace.initial +
        (pace.final - pace.initial) *
          (pace.duration * (progress ** 3 - progress ** 4 / 2) + Math.max(0, elapsed - pace.after - pace.duration))
  // Keep cycle boundaries exact when individual frame intervals are fractional.
  const frame = Math.floor((time * clip.frames.length) / (clip.interval * clip.frames.length))
  const index = !intro && animation.once ? Math.min(frame, clip.frames.length - 1) : frame % clip.frames.length
  return {
    glyph: clip.frames[index]!,
    level: clip.levels?.[index] ?? 1,
    complete: !intro && !!animation.once && frame >= clip.frames.length - 1,
  }
}

export const SEED_WORK: OneCellMotion = {
  frames: Array.from({ length: 40 }, () => "\u25aa"),
  interval: 40,
  levels: Array.from({ length: 40 }, (_, index) => 0.3 + (0.7 * (1 - Math.cos((index / 40) * 2 * Math.PI))) / 2),
  intro: {
    frames: Array.from({ length: 80 }, () => "\u25aa"),
    interval: 40,
    levels: Array.from({ length: 80 }, (_, index) => {
      const phase = index / 80
      return 0.3 + 0.7 * (phase < 0.125 ? phase / 0.125 : phase < 0.375 ? 1 : ((1 - phase) / 0.625) ** 3)
    }),
  },
  pace: { initial: 1.25, final: 0.5, after: 30_000, duration: 30_000 },
}

const WORK_PACE = { initial: 1.2, final: 0.96, after: 30_000, duration: 30_000 }
const lower = [2, 3, 5, 7, 6, 4]

export const BLOCK_LOW_COMET: OneCellMotion = {
  frames: lower.flatMap((point, index, path) => {
    const leading = (1 << point) | (1 << path[(index + 5) % 6]!)
    const full = leading | (1 << path[(index + 4) % 6]!)
    return [full, full, full, leading, leading].map(octantGlyph)
  }),
  interval: 40,
  pace: WORK_PACE,
}

export const BLOCK_SOFT_SWEEP: OneCellMotion = {
  frames: [0x14, 0x14, 0x14, 0x1c, 0x3c, 0x38, 0x28, 0x28, 0x28, 0x38, 0x3c, 0x1c].map(octantGlyph),
  interval: 100,
  pace: WORK_PACE,
}

export const BLOCK_SOFT_SLIDE: OneCellMotion = {
  frames: [0x14, 0x14, 0x14, 0x14, 0x14, 0x28, 0x28, 0x28, 0x28, 0x28].map(octantGlyph),
  interval: 100,
  levels: [0.55, 0.85, 1, 0.85, 0.55, 0.55, 0.85, 1, 0.85, 0.55],
}

export const WORK_SPINNERS = {
  "block-soft-slide": BLOCK_SOFT_SLIDE,
  "block-soft-sweep": BLOCK_SOFT_SWEEP,
  "block-low-comet": BLOCK_LOW_COMET,
  "block-low-duet": {
    frames: lower.slice(0, 3).flatMap((point, index) => {
      const heads = (1 << point) | (1 << lower[(index + 3) % 6]!)
      const full = heads | (1 << lower[(index + 2) % 6]!) | (1 << lower[(index + 5) % 6]!)
      return [full, full, full, heads].map(octantGlyph)
    }),
    interval: 60,
  },
  "block-shuttle": { frames: [0x14, 0x28].map(octantGlyph), interval: 500 },
  "block-bridge": { frames: [0x14, 0x14, 0x14, 0x3c, 0x28, 0x28, 0x28, 0x3c].map(octantGlyph), interval: 120 },
  "block-squeeze": {
    frames: [0x14, 0x14, 0x14, 0x10, 0x20, 0x28, 0x28, 0x28, 0x20, 0x10].map(octantGlyph),
    interval: 100,
  },
  "small-toggle": { frames: Array.from("\u25ab\u25aa"), interval: 320 },
  "square-toggle": { frames: Array.from("\u25a1\u25a0"), interval: 500 },
  "grow-shrink": { frames: Array.from("\u25ab\u25ab\u25aa\u25a0\u25aa"), interval: 180 },
  "quadrant-orbit": { frames: Array.from("\u2598\u259d\u2597\u2596"), interval: 160 },
  crosshatch: { frames: Array.from("\u25a7\u25a9\u25a8\u25a9"), interval: 240 },
  "density-wave": { frames: Array.from("\u2591\u2591\u2591\u2592\u2593\u2588\u2593\u2592"), interval: 160 },
  seed: SEED_WORK,
} satisfies Record<Config.MiniWorkSpinner, OneCellMotion>

export const SEED_LAUNCH: OneCellMotion = {
  frames: Array.from({ length: 21 }, (_, index) => (index < 10 ? "\u25ab" : "\u25aa")),
  interval: 40,
  levels: SEED_WORK.levels!.slice(0, 21),
  once: true,
}

export const SEED_MONO: OneCellMotion = { frames: ["-", "\\", "|", "/"], interval: 120 }

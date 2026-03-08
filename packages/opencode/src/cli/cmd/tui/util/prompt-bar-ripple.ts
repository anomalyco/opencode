import { RGBA } from "@opentui/core"
import type { PromptBarVisualTheme } from "./prompt-bar-visual"

export type RippleDirection = "down-right" | "down-left" | "up-right" | "up-left"

export type PromptBarRippleConfig = {
  speed: number
  intensity: number
  direction: RippleDirection
}

const DIRECTION_VECTORS: Record<RippleDirection, [number, number]> = {
  "down-right": [1, 1],
  "down-left": [-1, 1],
  "up-right": [1, -1],
  "up-left": [-1, -1],
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val))
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromValues(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t)
}

export function resolvePromptBarRippleConfig(opts?: {
  speed?: number
  intensity?: number
  direction?: RippleDirection
}): PromptBarRippleConfig {
  return {
    speed: clamp(opts?.speed ?? 0.18, 0.02, 1),
    intensity: clamp(opts?.intensity ?? 0.35, 0, 1),
    direction: opts?.direction ?? "down-right",
  }
}

export function computeRippleColor(
  x: number,
  y: number,
  width: number,
  height: number,
  tick: number,
  theme: PromptBarVisualTheme,
  config: PromptBarRippleConfig,
): RGBA {
  const u = x / Math.max(1, width - 1)
  const v = y / Math.max(1, height - 1)
  const dir = DIRECTION_VECTORS[config.direction]
  const d = (u * dir[0] + v * dir[1] + 1) / 2
  const phase = d * 2 * Math.PI * 2.25 + tick * config.speed
  const ripple = (Math.sin(phase) + 1) / 2
  const base = mix(theme.primary, theme.accent, ripple)
  return mix(base, theme.secondary, ripple * config.intensity)
}

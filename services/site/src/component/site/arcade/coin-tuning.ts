import { createSignal } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { z } from "zod"
import type { CoinLight } from "./coin3d"
import { layerValues } from "./layers-tuning"

/**
 * The token's poses and the coin → screen timings, in one place (Settings › 404 arcade › Coin):
 * how it turns when picked up, how it lines up with the slot, and the fade to black and back.
 * Values persist in localStorage; "Copy values" exports them as JSON to bake in here as defaults.
 */

type Range = { label: string; min: number; max: number; step: number; value: number; unit: string }
const angle = (label: string, value: number): Range => ({ label, min: -180, max: 180, step: 1, value, unit: "°" })
const ms = (label: string, min: number, max: number, value: number): Range => ({
  label,
  min,
  max,
  step: 10,
  value,
  unit: "ms",
})

export const coinControls = {
  held: {
    title: "Held",
    items: {
      tilt: angle("Rotate X (tilt)", 8),
      turn: angle("Rotate Y (turn)", 0),
      spin: angle("Rotate Z (spin)", 0),
      perspective: { label: "Perspective (× coin size)", min: 1, max: 20, step: 0.5, value: 6, unit: "×" },
      pickup: ms("Pickup rotation", 0, 1000, 220),
    },
  },
  slot: {
    title: "Insert",
    items: {
      tilt: angle("Rotate X (tilt)", 0),
      turn: angle("Rotate Y (turn)", 112),
      spin: angle("Rotate Z (spin)", 0),
      lean: { label: "Lean (screen plane)", min: -30, max: 30, step: 0.5, value: 3.5, unit: "°" },
      align: ms("Line up", 100, 1200, 360),
      slide: ms("Slide in", 100, 1200, 420),
    },
  },
  light: {
    title: "Light",
    items: {
      follow: { label: "Follow the moon beam (1) or manual (0)", min: 0, max: 1, step: 1, value: 1, unit: "" },
      angle: angle("Direction (offset from the beam, or manual)", 0),
      temperature: {
        label: "Colour (cool − / warm +), offset from the beam",
        min: -100,
        max: 100,
        step: 1,
        value: 0,
        unit: "",
      },
      intensity: { label: "Intensity", min: 0, max: 6, step: 0.05, value: 3.2, unit: "" },
      ambient: { label: "Ambient (room reflection)", min: 0, max: 3, step: 0.05, value: 2.4, unit: "" },
      tint: { label: "Metal (silver → brass)", min: 0, max: 1, step: 0.01, value: 0, unit: "" },
      glow: { label: "Glow", min: 0, max: 1, step: 0.01, value: 0, unit: "" },
      rim: { label: "Rim light", min: 0, max: 3, step: 0.05, value: 0.5, unit: "" },
    },
  },
  title: {
    title: "Title",
    items: {
      reveal: ms("Logo reveal (pixels or column wipe)", 200, 2000, 1050),
      order: { label: "Pixel order (0 random, 1 left to right)", min: 0, max: 1, step: 0.05, value: 0.45, unit: "" },
      arcade: ms("ARCADE after the logo", 0, 1000, 200),
    },
  },
  fade: {
    title: "Fade",
    items: {
      out: ms("Fade out", 100, 1200, 400),
      hold: ms("Hold black", 0, 800, 150),
      up: ms("Fade up", 100, 1500, 520),
      still: ms("404 before boot", 0, 2000, 500),
    },
  },
} as const

type Controls = typeof coinControls
export type CoinGroup = keyof Controls
export type CoinValues = { [G in CoinGroup]: { [K in keyof Controls[G]["items"]]: number } }

const defaults = () =>
  Object.fromEntries(
    Object.entries(coinControls).map(([group, entry]) => [
      group,
      Object.fromEntries(Object.entries(entry.items).map(([key, item]) => [key, item.value])),
    ]),
  ) as CoinValues

const storageKey = "opencode-arcade-coin-v1"
const saved = z.record(z.string(), z.record(z.string(), z.number()))

export const [coinValues, setCoinValues] = createStore<CoinValues>(defaults())
/** Settings › Coin › Preview: the token held still over the cabinet, in its held pose. */
export const [coinPreview, setCoinPreview] = createSignal(false)
/** Bumped by Settings › Coin › Replay insert. */
export const [coinReplay, setCoinReplay] = createSignal(0)

/** Saved values over the defaults, each kept inside its control's range. */
export function loadCoinValues() {
  const parsed = saved.safeParse(readJson(localStorage.getItem(storageKey)))
  if (!parsed.success) return
  const next = defaults()
  for (const [group, entry] of Object.entries(coinControls) as [CoinGroup, Controls[CoinGroup]][])
    for (const [key, item] of Object.entries(entry.items) as [string, Range][]) {
      const value = parsed.data[group]?.[key]
      if (value !== undefined)
        (next[group] as Record<string, number>)[key] = Math.min(item.max, Math.max(item.min, value))
    }
  setCoinValues(reconcile(next))
}

export function setCoinValue(group: CoinGroup, key: string, value: number) {
  setCoinValues(group, key as never, value as never)
  localStorage.setItem(storageKey, JSON.stringify(unwrap(coinValues)))
}

export function resetCoinValues() {
  setCoinValues(reconcile(defaults()))
  localStorage.removeItem(storageKey)
}

export const coinValuesJson = () => JSON.stringify(unwrap(coinValues), null, 2)

function readJson(text: string | null) {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

// The painted beam's own direction in the room still (public/arcade404/layers/layers.json
// beam.angle: degrees, image y down), and the beam colour ramps layers-gl.ts uses.
const beamAngle = 132.72
const warm = [1, 0.71, 0.42]
const cool = [0.42, 0.66, 1]

/** The coin's light from the Coin › Light values: by default the moon beam's direction and colour. */
export function coinLight(): CoinLight {
  const light = coinValues.light
  const follow = light.follow >= 0.5
  const temperature =
    Math.max(-100, Math.min(100, (follow ? layerValues.beam.temperature : 0) + light.temperature)) / 100
  const target = temperature > 0 ? warm : cool
  const color = target.map((channel) => 1 + (channel / Math.max(...target) - 1) * Math.abs(temperature)) as [
    number,
    number,
    number,
  ]
  // The beam travels this way across the image; the light comes from the opposite side, a little
  // behind the coin (y up in the coin's scene).
  const degrees = (follow ? beamAngle + layerValues.beam.angle : 90) + light.angle
  const radians = (degrees * Math.PI) / 180
  return {
    color,
    intensity: light.intensity * (follow ? Math.min(1.5, layerValues.beam.intensity / 1.71) : 1),
    // A little in front of the coin, so its face reads; the beam itself comes from behind the cabinet.
    direction: [-Math.cos(radians), Math.sin(radians), 0.25],
    ambient: light.ambient,
    tint: light.tint,
    glow: light.glow,
    rim: light.rim,
  }
}

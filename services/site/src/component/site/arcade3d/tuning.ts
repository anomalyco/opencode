import { createEffect, createSignal } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { z } from "zod"
import { setSiteSetting, siteSettings } from "../settings"

/**
 * Live settings for the three.js arcade, shown in the site's Settings panel ("404 arcade", ⇧S or the
 * gear). Each control has a range and a default; the defaults are the tuned look. Values persist in
 * the site's settings and apply every frame.
 */

type Range = { label: string; min: number; max: number; step: number; value: number; unit?: string }
const range = (label: string, min: number, max: number, step: number, value: number, unit?: string): Range => ({
  label,
  min,
  max,
  step,
  value,
  unit,
})

export const controls = {
  moon: {
    title: "Moonlight",
    items: {
      intensity: range("Shaft brightness", 0, 3, 0.01, 0.9),
      density: range("Shaft density", 0, 3, 0.01, 0.89),
      width: range("Beam width", 0.4, 2.5, 0.01, 1.52),
      softness: range("Beam softness", 0, 1, 0.01, 0.5),
      azimuth: range("Direction (azimuth)", -60, 60, 0.5, 0, "°"),
      elevation: range("Direction (elevation)", -30, 30, 0.5, 1, "°"),
      pool: range("Floor pool", 0, 3, 0.01, 1.16),
      key: range("Light on cabinet", 0, 4, 0.01, 1),
      hue: range("Hue", 0, 360, 1, 197, "°"),
      saturation: range("Saturation", 0, 1, 0.01, 0.45),
      clouds: range("Cloud flicker", 0, 1, 0.01, 0.25),
    },
  },
  glow: {
    title: "Machine glow (cabinet light on the room)",
    items: {
      intensity: range("Intensity", 0, 4, 0.01, 1),
      radius: range("Radius", 0.3, 6, 0.05, 2.2, " m"),
      falloff: range("Falloff", 0.5, 4, 0.05, 2),
      hue: range("Hue", 0, 360, 1, 221, "°"),
      saturation: range("Saturation", 0, 1, 0.01, 0.82),
    },
  },
  screen: {
    title: "Screen light spill",
    items: {
      intensity: range("Intensity", 0, 4, 0.01, 1),
      radius: range("Radius", 0.3, 6, 0.05, 3.2, " m"),
      hue: range("Hue", 0, 360, 1, 221, "°"),
      saturation: range("Saturation", 0, 1, 0.01, 0.76),
    },
  },
  edges: {
    title: "Edge strips and marquee light",
    items: {
      intensity: range("Intensity", 0, 4, 0.01, 1),
      hue: range("Hue", 0, 360, 1, 213, "°"),
      saturation: range("Saturation", 0, 1, 0.01, 0.65),
    },
  },
  room: {
    title: "Ambient and backdrop",
    items: {
      ambient: range("Ambient light", 0, 3, 0.01, 1),
      exposure: range("Backdrop exposure", -2, 2, 0.01, 0, " EV"),
      contrast: range("Contrast", 0.5, 1.5, 0.01, 1),
      saturation: range("Saturation", 0, 2, 0.01, 1),
      hue: range("Hue shift", -60, 60, 0.5, 0, "°"),
      temperature: range("Temperature", -1, 1, 0.01, 0),
      tint: range("Tint", -1, 1, 0.01, 0),
      black: range("Black level", -0.1, 0.1, 0.001, 0),
      vignette: range("Vignette", 0, 1, 0.01, 0),
      defocus: range("Close-up defocus", 0, 1, 0.01, 1),
    },
  },
  dust: {
    title: "Dust",
    items: {
      count: range("Count", 0, 20000, 100, 9000),
      size: range("Size", 0.2, 4, 0.01, 1.6),
      speed: range("Drift speed", 0, 4, 0.01, 1),
      glint: range("Brightness in the light", 0, 6, 0.01, 2.5),
      outside: range("Visibility outside the light", 0, 0.3, 0.001, 0.02),
      dof: range("Depth of field", 0, 3, 0.01, 1),
      pointer: range("Reaction to the coin", 0, 3, 0.01, 1),
    },
  },
  crt: {
    title: "CRT",
    items: {
      curvature: range("Curvature", 0, 0.2, 0.001, 0.07),
      scanlines: range("Scanlines", 0, 1, 0.01, 0.85),
      mask: range("Shadow mask", 0, 1, 0.01, 0.8),
      bloom: range("Bloom and halation", 0, 2, 0.01, 0.9),
      aberration: range("Chromatic aberration", 0, 0.01, 0.0001, 0.0022),
      flicker: range("Flicker", 0, 3, 0.01, 1),
      roll: range("Rolling band", 0, 0.3, 0.001, 0.06),
      noise: range("Noise", 0, 0.15, 0.001, 0.025),
      reflection: range("Glass reflection", 0, 3, 0.01, 1),
    },
  },
  camera: {
    title: "Camera",
    items: {
      fov: range("Close-up field of view", 20, 60, 0.5, 38, "°"),
      speed: range("Move speed", 0.3, 3, 0.01, 1),
    },
  },
} as const

export type Group = keyof typeof controls
export const qualities = ["auto", "high", "medium", "low"] as const
export type QualitySetting = (typeof qualities)[number]

type Values = { [G in Group]: { [K in keyof (typeof controls)[G]["items"]]: number } } & { quality: QualitySetting }

const defaults = () =>
  Object.fromEntries([
    ...Object.entries(controls).map(([group, section]) => [
      group,
      Object.fromEntries(Object.entries(section.items).map(([key, item]) => [key, item.value])),
    ]),
    ["quality", "auto"],
  ]) as Values

const [tuning, setTuning] = createStore<Values>(defaults())
export { tuning }
const [fps, setFps] = createSignal(0)
export { fps, setFps }

/** Merge saved values over the defaults; anything missing or out of range falls back. */
export function applyTuning(input: unknown) {
  const schema = z
    .object({
      ...Object.fromEntries(
        Object.entries(controls).map(([group, section]) => [
          group,
          z
            .object(
              Object.fromEntries(
                Object.entries(section.items).map(([key, item]) => [key, z.number().min(item.min).max(item.max)]),
              ),
            )
            .partial(),
        ]),
      ),
      quality: z.enum(qualities),
    })
    .partial()
  const parsed = schema.safeParse(input)
  if (!parsed.success) return false
  const next = defaults()
  const data = parsed.data as Partial<Record<string, unknown>>
  for (const group of Object.keys(controls) as Group[]) Object.assign(next[group], data[group] ?? {})
  if (parsed.data.quality) next.quality = parsed.data.quality
  setTuning(reconcile(next))
  return true
}

/**
 * The values live in the site's settings (`arcade3d`), so they persist, export and import with
 * the rest; this follows that setting, including Reset and Import from the Settings panel.
 */
export function followTuning() {
  // Production always renders the default settings, so there is nothing to follow, and its bundle
  // leaves zod out.
  if (import.meta.env.PROD) return
  createEffect(() => {
    if (!applyTuning(siteSettings.arcade3d)) setTuning(reconcile(defaults()))
  })
}

export function setTuningValue(group: Group, key: string, value: number) {
  setSiteSetting("arcade3d", { ...unwrap(tuning), [group]: { ...unwrap(tuning)[group], [key]: value } })
}

export function setQualitySetting(value: QualitySetting) {
  setSiteSetting("arcade3d", { ...unwrap(tuning), quality: value })
}

export function resetTuning() {
  setSiteSetting("arcade3d", {})
}

/** Hue (degrees) and saturation (0–1) at full value, as sRGB channels (0–1). No three.js here: this
 * module loads with the page, before three.js. */
export const hsv = (hue: number, saturation: number): [number, number, number] => {
  const f = (n: number) => {
    const k = (n + hue / 60) % 6
    return 1 - saturation * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}

/** The same colour as CSS, for the swatches. */
export const swatch = (hue: number, saturation: number) =>
  `rgb(${hsv(hue, saturation)
    .map((channel) => Math.round(channel * 255))
    .join(" ")})`

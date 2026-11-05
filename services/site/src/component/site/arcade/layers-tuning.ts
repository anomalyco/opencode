import { createStore, reconcile, unwrap } from "solid-js/store"
import { z } from "zod"

/**
 * Live controls for the layered arcade (mode "layers"): the light and particle layer between the
 * painted room and the painted cabinet, and an overall grade. The defaults rebuild the painting
 * (beam, floor light and specks where they were); the panel's "Copy values" exports the current
 * values as JSON so they can be baked in here as new defaults (David's tuning, Nov 5 2026). Values
 * persist in localStorage. public/arcade404/layers/poster-*.{avif,webp} bake in these defaults' first frame:
 * re-bake it when they change.
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

export const layerControls = {
  beam: {
    title: "Moon beam",
    items: {
      intensity: range("Intensity", 0, 3, 0.01, 1.71),
      width: range("Width", 0.3, 2.5, 0.01, 0.95),
      angle: range("Angle", -30, 30, 0.5, -3, "°"),
      temperature: range("Colour (cool − / warm +)", -100, 100, 1, -74),
      shimmer: range("Shimmer", 0, 1, 0.01, 0.13),
    },
  },
  floor: {
    title: "Floor light",
    items: {
      intensity: range("Intensity", 0, 5, 0.01, 3),
    },
  },
  particles: {
    title: "Particles",
    items: {
      count: range("Count", 0, 3000, 10, 1770),
      size: range("Size", 0.3, 4, 0.01, 1),
      speed: range("Speed", 0, 4, 0.01, 2.13),
      brightness: range("Brightness", 0, 3, 0.01, 0.91),
      twinkle: range("Twinkle", 0, 1, 0.01, 0.5),
    },
  },
  grade: {
    title: "Grade",
    items: {
      saturation: range("Saturation", 0, 2, 0.01, 0.67),
      brightness: range("Brightness", 0.5, 1.5, 0.01, 0.89),
    },
  },
} as const

type Controls = typeof layerControls
export type LayerValues = { [G in keyof Controls]: { [K in keyof Controls[G]["items"]]: number } }

const defaults = () =>
  Object.fromEntries(
    Object.entries(layerControls).map(([group, entry]) => [
      group,
      Object.fromEntries(Object.entries(entry.items).map(([key, item]) => [key, item.value])),
    ]),
  ) as LayerValues

const storageKey = "opencode-arcade-layers-v1"
const saved = z.record(z.string(), z.record(z.string(), z.number()))

export const [layerValues, setLayerValues] = createStore<LayerValues>(defaults())

/** Reads saved values over the defaults, keeping each one inside its control's range. */
export function loadLayerValues() {
  const parsed = saved.safeParse(readJson(localStorage.getItem(storageKey)))
  if (!parsed.success) return
  const next = defaults()
  for (const [group, entry] of Object.entries(layerControls) as [keyof Controls, Controls[keyof Controls]][])
    for (const [key, item] of Object.entries(entry.items) as [string, Range][]) {
      const value = parsed.data[group]?.[key]
      if (value !== undefined)
        (next[group] as Record<string, number>)[key] = Math.min(item.max, Math.max(item.min, value))
    }
  setLayerValues(reconcile(next))
}

export function setLayerValue(group: keyof Controls, key: string, value: number) {
  setLayerValues(group, key as never, value as never)
  localStorage.setItem(storageKey, JSON.stringify(unwrap(layerValues)))
}

export function resetLayerValues() {
  setLayerValues(reconcile(defaults()))
  localStorage.removeItem(storageKey)
}

export const layerValuesJson = () => JSON.stringify(unwrap(layerValues), null, 2)

function readJson(text: string | null) {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

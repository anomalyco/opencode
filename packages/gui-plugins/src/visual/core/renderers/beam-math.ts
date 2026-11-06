import { clamp, num, object, objects, str } from "../json"
import type { VisualSpec } from "../spec"

export type Load =
  | { readonly kind: "point"; readonly x: number; readonly value: number }
  | { readonly kind: "udl"; readonly from: number; readonly to: number; readonly value: number }

export interface Section {
  readonly form: "rect" | "circle" | "ibeam"
  readonly b: number
  readonly h: number
  readonly d: number
  readonly tw: number
  readonly tf: number
}

export interface BeamModel {
  readonly type: "simply-supported" | "cantilever"
  readonly length: number
  readonly unit: string
  readonly loads: Load[]
  readonly section?: Section
  readonly youngs: number
  readonly yield: number
}

export function readBeam(spec: VisualSpec): BeamModel {
  const data = object(spec.data) ?? {}
  const length = clamp(num(data.length, 4), 0.1, 1000)
  const unit = str(data.unit, "m")
  const loads: Load[] = []

  for (const item of objects(data.loads).slice(0, 24)) {
    if (str(item.type, "point") === "udl") {
      const from = clamp(num(item.from, 0), 0, length)
      const to = clamp(num(item.to, length), 0, length)

      if (to > from) loads.push({ kind: "udl", from, to, value: num(item.magnitude, 1) })
    } else {
      loads.push({ kind: "point", x: clamp(num(item.x, length / 2), 0, length), value: num(item.magnitude, 1) })
    }
  }

  const sectionData = object(data.section)

  const section: Section | undefined = sectionData
    ? {
        form: sectionForm(str(sectionData.shape, "rect")),
        b: clamp(num(sectionData.b, 100), 1, 2000),
        h: clamp(num(sectionData.h, 200), 1, 2000),
        d: clamp(num(sectionData.d, 120), 1, 2000),
        tw: clamp(num(sectionData.tw, 10), 1, 500),
        tf: clamp(num(sectionData.tf, 12), 1, 500),
      }
    : undefined

  return {
    type: str(data.type, "simply-supported") === "cantilever" ? "cantilever" : "simply-supported",
    length,
    unit,
    loads,
    section,
    youngs: clamp(num(data.E, 200), 0.1, 1000),
    yield: clamp(num(data.yield, 250), 1, 5000),
  }
}

function sectionForm(value: string): Section["form"] {
  if (value === "circle") return "circle"

  if (value === "ibeam") return "ibeam"

  return "rect"
}

function sectionProperties(section: Section) {
  if (section.form === "circle") {
    const d = section.d / 1000

    return { area: (Math.PI * d ** 2) / 4, inertia: (Math.PI * d ** 4) / 64, c: d / 2 }
  }

  if (section.form === "ibeam") {
    const b = section.b / 1000
    const h = section.h / 1000
    const tw = section.tw / 1000
    const tf = section.tf / 1000
    const inertia = (b * h ** 3 - Math.max(0, b - tw) * Math.max(0, h - 2 * tf) ** 3) / 12
    const area = b * h - Math.max(0, b - tw) * Math.max(0, h - 2 * tf)

    return { area, inertia, c: h / 2 }
  }

  const b = section.b / 1000
  const h = section.h / 1000

  return { area: b * h, inertia: (b * h ** 3) / 12, c: h / 2 }
}

export function solve(model: BeamModel) {
  const L = model.length
  const points = 241
  const x = Array.from({ length: points }, (_, index) => (index / (points - 1)) * L)
  const total = model.loads.reduce((sum, load) => sum + (load.kind === "point" ? load.value : load.value * (load.to - load.from)), 0)
  const momentAt = (load: Load) => (load.kind === "point" ? load.value * load.x : load.value * (load.to - load.from) * ((load.from + load.to) / 2))
  const totalMoment = model.loads.reduce((sum, load) => sum + momentAt(load), 0)

  let leftReaction = 0
  let rightReaction = 0
  let fixedMoment = 0

  if (model.type === "simply-supported") {
    rightReaction = totalMoment / L
    leftReaction = total - rightReaction
  } else {
    leftReaction = total
    fixedMoment = totalMoment
  }

  const shear: number[] = []
  const moment: number[] = []

  for (const at of x) {
    let v = leftReaction
    let m = leftReaction * at - (model.type === "cantilever" ? fixedMoment : 0)

    for (const load of model.loads) {
      if (load.kind === "point" && at >= load.x) {
        v -= load.value
        m -= load.value * (at - load.x)
      }

      if (load.kind === "udl") {
        const over = clamp(at - load.from, 0, load.to - load.from)
        v -= load.value * over
        m -= load.value * over * (at - (load.from + over / 2))
      }
    }

    shear.push(v)
    moment.push(m)
  }

  const props = model.section ? sectionProperties(model.section) : undefined
  const peakMoment = moment.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0)
  const peakShear = shear.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0)
  const stress = props ? (Math.abs(peakMoment) * 1000 * props.c) / props.inertia / 1e6 : undefined

  let deflection: number[] | undefined
  let maxDeflection = 0

  if (props) {
    const ei = model.youngs * 1e9 * props.inertia
    const dx = L / (points - 1)
    const slope: number[] = [0]
    const curve: number[] = [0]

    for (let index = 1; index < points; index += 1) {
      const k0 = (moment[index - 1] * 1000) / ei
      const k1 = (moment[index] * 1000) / ei
      slope.push(slope[index - 1] + ((k0 + k1) / 2) * dx)
      curve.push(curve[index - 1] + ((slope[index - 1] + slope[index]) / 2) * dx)
    }

    if (model.type === "simply-supported") {
      const end = curve[points - 1]

      for (let index = 0; index < points; index += 1) curve[index] -= (end * x[index]) / L
    }

    deflection = curve
    maxDeflection = Math.max(...curve.map((value) => Math.abs(value))) * 1000
  }

  return {
    x,
    shear,
    moment,
    deflection,
    leftReaction,
    rightReaction,
    fixedMoment,
    peakMoment,
    peakShear,
    stress,
    maxDeflection,
    total,
    props,
  }
}

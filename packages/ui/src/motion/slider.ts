export interface SliderSpec {
  min: number
  max: number
  step: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function validate(spec: SliderSpec) {
  if (
    !Number.isFinite(spec.min) ||
    !Number.isFinite(spec.max) ||
    !Number.isFinite(spec.step) ||
    spec.max < spec.min ||
    spec.step <= 0
  )
    throw new RangeError("Invalid slider range")
}

/** Includes both endpoints. Non-divisible ranges include a final shorter interval. */
export function sliderStops(spec: SliderSpec): number {
  validate(spec)

  return Math.ceil((spec.max - spec.min) / spec.step - 1e-10) + 1
}

export function sliderValue(spec: SliderSpec, value: number): number {
  validate(spec)
  const nearest = spec.min + Math.round((value - spec.min) / spec.step) * spec.step
  const result = Math.abs(value - spec.max) < Math.abs(value - nearest) ? spec.max : nearest

  return Number(clamp(result, spec.min, spec.max).toPrecision(14))
}

export function sliderFraction(spec: SliderSpec, value: number): number {
  return spec.max === spec.min ? 0 : clamp((value - spec.min) / (spec.max - spec.min), 0, 1)
}

export function sliderStep(spec: SliderSpec, value: number, direction: -1 | 1, count = 1): number {
  const last = sliderStops(spec) - 1
  const current = value >= spec.max ? last : Math.round((value - spec.min) / spec.step)
  const index = clamp(current + direction * count, 0, last)

  return sliderValue(spec, Math.min(spec.max, spec.min + index * spec.step))
}

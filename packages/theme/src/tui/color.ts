type OklchColor = {
  l: number
  c: number
  h: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function hue(value: number) {
  return ((value % 360) + 360) % 360
}

function linearToSrgb(value: number) {
  if (value <= 0.0031308) return value * 12.92
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055
}

function srgbToLinear(value: number) {
  if (value <= 0.04045) return value / 12.92
  return Math.pow((value + 0.055) / 1.055, 2.4)
}

export function rgbToOklch(red: number, green: number, blue: number): OklchColor {
  const linearRed = srgbToLinear(red)
  const linearGreen = srgbToLinear(green)
  const linearBlue = srgbToLinear(blue)
  const lRoot = Math.cbrt(0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue)
  const mRoot = Math.cbrt(0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue)
  const sRoot = Math.cbrt(0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue)
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  const chroma = Math.sqrt(a * a + b * b)
  const angle = Math.atan2(b, a) * (180 / Math.PI)
  return { l: lightness, c: chroma, h: angle < 0 ? angle + 360 : angle }
}

function oklchToRgb(color: OklchColor) {
  const a = color.c * Math.cos((color.h * Math.PI) / 180)
  const b = color.c * Math.sin((color.h * Math.PI) / 180)
  const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot * lRoot * lRoot
  const m = mRoot * mRoot * mRoot
  const s = sRoot * sRoot * sRoot
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

function fitOklch(color: OklchColor): OklchColor {
  const base = { l: clamp(color.l, 0, 1), c: Math.max(0, color.c), h: hue(color.h) }
  const rgb = oklchToRgb(base)
  if (rgb.r >= 0 && rgb.r <= 1 && rgb.g >= 0 && rgb.g <= 1 && rgb.b >= 0 && rgb.b <= 1) return base

  const fitted = Array.from({ length: 24 }).reduce<OklchColor | undefined>((result, _, index) => {
    if (result) return result
    const next = { ...base, c: base.c * Math.pow(0.9, index + 1) }
    const output = oklchToRgb(next)
    if (output.r >= 0 && output.r <= 1 && output.g >= 0 && output.g <= 1 && output.b >= 0 && output.b <= 1) return next
  }, undefined)
  return fitted ?? { ...base, c: 0 }
}

export function oklchToHex(color: OklchColor) {
  const rgb = oklchToRgb(fitOklch(color))
  const toHex = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

import { RGBA } from "@opentui/core"

export type DiagramRgb = readonly [number, number, number]
export type DiagramFadeStep = 1 | 2 | 3 | 4 | 5

export const DIAGRAM_FADE_STEPS = [1, 2, 3, 4, 5] as const satisfies readonly DiagramFadeStep[]

export function numberedStyleKeys<Prefix extends string, Step extends number>(
  prefix: Prefix,
  steps: readonly Step[],
): Array<`${Prefix}${Step}`> {
  return steps.map((step) => `${prefix}${step}` as `${Prefix}${Step}`)
}

export function mixChannel(left: number, right: number, amount: number): number {
  return Math.round(left + (right - left) * amount)
}

export function mixRgb(left: DiagramRgb, right: DiagramRgb, amount: number): DiagramRgb {
  return [
    mixChannel(left[0], right[0], amount),
    mixChannel(left[1], right[1], amount),
    mixChannel(left[2], right[2], amount),
  ]
}

export function ansiFg(rgb: DiagramRgb): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
}

export function ansiBg(rgb: DiagramRgb): string {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
}

export function rgba(rgb: DiagramRgb): RGBA {
  return RGBA.fromInts(rgb[0], rgb[1], rgb[2], 255)
}

export function blendColor(from: RGBA, to: RGBA, amount: number): RGBA
export function blendColor(from: RGBA | undefined, to: RGBA | undefined, amount: number): RGBA | undefined
export function blendColor(from: RGBA | undefined, to: RGBA | undefined, amount: number): RGBA | undefined {
  if (!from && !to) return undefined
  if (!from) return to
  if (!to) return from

  const [fromR, fromG, fromB, fromA] = from.toInts()
  const [toR, toG, toB, toA] = to.toInts()
  const mix = (left: number, right: number) => left + (right - left) * amount

  return RGBA.fromInts(mix(fromR, toR), mix(fromG, toG), mix(fromB, toB), mix(fromA, toA))
}

export function colorsEqual(left?: RGBA, right?: RGBA): boolean {
  if (!left || !right) return left === right
  return left.equals(right)
}

export function brightenColor(color: RGBA | undefined, amount: number = 0.35): RGBA | undefined {
  if (!color) return undefined

  const [r, g, b, a] = color.toInts()
  return RGBA.fromInts(mixChannel(r, 255, amount), mixChannel(g, 255, amount), mixChannel(b, 255, amount), a)
}

export function createAnsiRampTheme<Style extends string>(
  styles: readonly Style[],
  from: DiagramRgb,
  to: DiagramRgb,
): Record<Style, string> {
  return Object.fromEntries(
    styles.map((style, index) => [style, ansiFg(mixRgb(from, to, (index + 1) / (styles.length + 1)))]),
  ) as Record<Style, string>
}

export function createColorRampTheme<Style extends string>(
  styles: readonly Style[],
  from: RGBA,
  to: RGBA,
): Record<Style, RGBA>
export function createColorRampTheme<Style extends string>(
  styles: readonly Style[],
  from: RGBA | undefined,
  to: RGBA | undefined,
): Record<Style, RGBA | undefined>
export function createColorRampTheme<Style extends string>(
  styles: readonly Style[],
  from: RGBA | undefined,
  to: RGBA | undefined,
): Record<Style, RGBA | undefined> {
  return Object.fromEntries(
    styles.map((style, index) => [style, blendColor(from, to, (index + 1) / (styles.length + 1))]),
  ) as Record<Style, RGBA | undefined>
}

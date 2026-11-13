import type { Point } from "./geometry"

/**
 * The CSS `matrix3d` that maps a `width` × `height` box (transform origin at its top-left) onto
 * four points, in order top-left, top-right, bottom-right, bottom-left: a projective transform, so
 * a flat element lands exactly on a quad painted in perspective.
 */
export function homography(width: number, height: number, corners: [Point, Point, Point, Point]) {
  const m = coefficients(corners)
  const p0 = corners[0]
  const matrix = [
    m.a / width,
    m.d / width,
    0,
    m.g / width,
    m.b / height,
    m.e / height,
    0,
    m.k / height,
    0,
    0,
    1,
    0,
    p0.x,
    p0.y,
    0,
    1,
  ]
  return `matrix3d(${matrix.map((value) => value.toFixed(8)).join(",")})`
}

/**
 * Where the point (u, v) of the unit square lands under the same transform (u, v may lie outside
 * 0–1, for things around the quad); undefined when it would fall behind the viewer.
 */
export function quadPoint(corners: [Point, Point, Point, Point], u: number, v: number): Point | undefined {
  const m = coefficients(corners)
  const w = m.g * u + m.k * v + 1
  if (w <= 0.05) return undefined
  return { x: (m.a * u + m.b * v + corners[0].x) / w, y: (m.d * u + m.e * v + corners[0].y) / w }
}

/**
 * The inverse of `quadPoint`: where `point` (inside or near the quad) sits in the unit square, as
 * (u, v). Used to bring an outline traced in a painting into the screen's own box.
 */
export function unitPoint(corners: [Point, Point, Point, Point], point: Point): Point {
  const m = coefficients(corners)
  const p0 = corners[0]
  // (x, y, 1) ~ M (u, v, 1) with M = [[a, b, p0.x], [d, e, p0.y], [g, k, 1]]; solve by the adjugate.
  const [a, b, c, d, e, f, g, h] = [m.a, m.b, p0.x, m.d, m.e, p0.y, m.g, m.k]
  const inverse = [
    e - f * h,
    c * h - b,
    b * f - c * e,
    f * g - d,
    a - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ]
  const w = inverse[6] * point.x + inverse[7] * point.y + inverse[8]
  return {
    x: (inverse[0] * point.x + inverse[1] * point.y + inverse[2]) / w,
    y: (inverse[3] * point.x + inverse[4] * point.y + inverse[5]) / w,
  }
}

function coefficients(corners: [Point, Point, Point, Point]) {
  const [p0, p1, p2, p3] = corners
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9
  const g = (dx3 * dy2 - dx2 * dy3) / den
  const k = (dx1 * dy3 - dx3 * dy1) / den
  const a = p1.x - p0.x + g * p1.x
  const b = p3.x - p0.x + k * p3.x
  const d = p1.y - p0.y + g * p1.y
  const e = p3.y - p0.y + k * p3.y
  return { a, b, d, e, g, k }
}

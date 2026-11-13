import type { Point, Rect } from "./geometry"

/** A camera over world space: the world point at the viewport's centre, and screen px per world unit. */
export type View = { x: number; y: number; scale: number }
export type Viewport = { width: number; height: number }

/** Fit a world rectangle into the viewport (or a part of it: `area` is in viewport px). */
export function fit(rect: Rect, viewport: Viewport, mode: "contain" | "cover" = "contain", area?: Rect): View {
  const box = area ?? { x: 0, y: 0, w: viewport.width, h: viewport.height }
  const sx = box.w / rect.w
  const sy = box.h / rect.h
  const scale = mode === "cover" ? Math.max(sx, sy) : Math.min(sx, sy)
  // Shift the centre so the rectangle lands in `area` rather than the whole viewport.
  const offsetX = box.x + box.w / 2 - viewport.width / 2
  const offsetY = box.y + box.h / 2 - viewport.height / 2
  return { x: rect.x + rect.w / 2 - offsetX / scale, y: rect.y + rect.h / 2 - offsetY / scale, scale }
}

export const toScreen = (view: View, viewport: Viewport, point: Point): Point => ({
  x: (point.x - view.x) * view.scale + viewport.width / 2,
  y: (point.y - view.y) * view.scale + viewport.height / 2,
})

export const toWorld = (view: View, viewport: Viewport, point: Point): Point => ({
  x: (point.x - viewport.width / 2) / view.scale + view.x,
  y: (point.y - viewport.height / 2) / view.scale + view.y,
})

/**
 * A critically damped spring on the camera's centre and on the log of its scale, so zooming feels
 * even at every magnification and a new target mid-flight bends the path instead of restarting it.
 * `stiffness` sets the speed: about 4/stiffness seconds to settle.
 */
export function createCamera(initial: View) {
  const view = { ...initial }
  const velocity = { x: 0, y: 0, z: 0 }
  let target = { ...initial }
  let stiffness = 6
  return {
    view,
    get target() {
      return target
    },
    to(next: View, speed = 6) {
      target = { ...next }
      stiffness = speed
    },
    jump(next: View) {
      Object.assign(view, next)
      target = { ...next }
      velocity.x = velocity.y = velocity.z = 0
    },
    /** Advance by `dt` seconds. Returns true while still moving. */
    step(dt: number) {
      const k = stiffness * stiffness
      const c = 2 * stiffness
      // Pan velocity is measured in screen px, so a pan reads the same at every zoom.
      const z = Math.log(view.scale)
      const tz = Math.log(target.scale)
      const sub = Math.min(4, Math.ceil(dt / (1 / 120)))
      const h = dt / sub
      let zz = z
      for (let i = 0; i < sub; i++) {
        const s = Math.exp(zz)
        const ax = k * (target.x - view.x) * s - c * velocity.x
        const ay = k * (target.y - view.y) * s - c * velocity.y
        const az = k * (tz - zz) - c * velocity.z
        velocity.x += ax * h
        velocity.y += ay * h
        velocity.z += az * h
        view.x += (velocity.x * h) / s
        view.y += (velocity.y * h) / s
        zz += velocity.z * h
      }
      view.scale = Math.exp(zz)
      const still =
        Math.abs(tz - zz) < 1e-4 &&
        Math.abs(target.x - view.x) * view.scale < 0.05 &&
        Math.abs(target.y - view.y) * view.scale < 0.05 &&
        Math.hypot(velocity.x, velocity.y) < 0.05 &&
        Math.abs(velocity.z) < 1e-4
      if (still) this.jump(target)
      return !still
    },
  }
}

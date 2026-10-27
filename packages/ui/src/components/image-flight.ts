import { Spring, type DurationOptions } from "../motion"

/**
 * Geometry and motion for flying a preview image between its place on the page and the open preview.
 *
 * The flying image is laid out once at `base` and only ever transformed, so the flight runs on transform and
 * clip-path alone. A frame says where the whole image would be drawn (`image`, always the image's own aspect ratio),
 * which part of it shows (`clip`), and the corner radius of that visible part, all in viewport pixels. The preview's
 * panel flies with it as one surface (`surface`, with its own corner radius) that grows out of the visible image, and
 * `lift` says how far it has become the panel: 0 on the page, 1 open. Each of those numbers rides its own spring, so
 * the visible corners, crop and panel move evenly on screen.
 */

export type Box = { x: number; y: number; width: number; height: number }

export type FlightFrame = { image: Box; clip: Box; radius: number; surface: Box; surfaceRadius: number; lift: number }

/**
 * One critically damped spring for both directions, launched with a push of `KICK` times the remaining distance per
 * second, since a spring from rest starts too slowly. The shape is Claude's preview, fitted frame by frame at 0.2 s,
 * slowed to 0.3 s.
 */
export const FLIGHT_SPRING = { duration: 0.3, bounce: 0 }

/**
 * The launch push on `FLIGHT_SPRING`: Claude's 14 and 32.5 per second at 0.2 s, scaled to 0.3 s so the shape holds.
 * Other durations scale it the same way.
 */
export const KICK = { open: 28 / 3, close: 65 / 3 }

/** A flight frame with one spring per edge, so heading somewhere new mid-flight keeps the velocity it already has. */
export function createFlight(frame: FlightFrame) {
  const springs = values(frame).map((value) => Spring.fromDuration(value, FLIGHT_SPRING))

  return {
    /** Heads for `frame` on `tuning`, launched with a `KICK` push scaled to the spring's duration. */
    to(frame: FlightFrame, kick: number, tuning: DurationOptions = FLIGHT_SPRING) {
      const push = (kick * FLIGHT_SPRING.duration) / tuning.duration

      values(frame).forEach((target, index) => {
        const spring = springs[index]
        spring.omega = (2 * Math.PI) / tuning.duration
        spring.zeta = 1 - tuning.bounce
        spring.set(target, { velocity: spring.velocity + push * (target - spring.value) })
      })
    },
    /** Advances `dt` seconds; true until every edge has landed. */
    step(dt: number) {
      springs.forEach((spring) => spring.step(dt))

      // Within a quarter pixel and barely moving is landed: the rest of the way would not show, so snap it.
      if (springs.some((spring) => Math.abs(spring.value - spring.target) > 0.25 || Math.abs(spring.velocity) > 4))
        return true
      springs.forEach((spring) => spring.snap(spring.target))

      return false
    },
    frame(): FlightFrame {
      const [x, y, width, height, clipX, clipY, clipWidth, clipHeight, radius, ...panel] = springs.map(
        (spring) => spring.value,
      )

      const [surfaceX, surfaceY, surfaceWidth, surfaceHeight, surfaceRadius, lift] = panel

      return {
        image: { x, y, width, height },
        clip: { x: clipX, y: clipY, width: clipWidth, height: clipHeight },
        radius,
        surface: { x: surfaceX, y: surfaceY, width: surfaceWidth, height: surfaceHeight },
        surfaceRadius,
        lift: lift / 100,
      }
    },
  }
}

/** Where an element draws its whole image for an `object-fit`, centered as with the default `object-position`. */
export function fittedImage(box: Box, natural: { width: number; height: number }, fit: string): Box {
  const ratio = natural.width / natural.height

  // `fill` stretches the image; the flight keeps its aspect ratio, so it covers the box instead.
  const contain = fit === "contain" || fit === "scale-down"
  const wide = box.width / box.height > ratio
  const width = contain === wide ? box.height * ratio : box.width
  const height = contain === wide ? box.height : box.width / ratio

  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

/**
 * The frame of an element showing an image, cropped to the element's box and to `visible`, the part of it the page
 * shows. The panel starts as that visible part.
 */
export function elementFrame(
  box: Box,
  natural: { width: number; height: number },
  fit: string,
  radius: number,
  visible: Box = box,
): FlightFrame {
  const image = fittedImage(box, natural, fit)
  const clip = intersect(intersect(image, box), visible)

  return { image, clip, radius, surface: clip, surfaceRadius: radius, lift: 0 }
}

/** Styles that move an image laid out at `base` to `frame`, with `transform-origin: 0 0`. */
export function flightStyle(base: Box, frame: Pick<FlightFrame, "image" | "clip" | "radius">) {
  const scale = frame.image.width / base.width
  const top = (frame.clip.y - frame.image.y) / scale
  const right = (frame.image.x + frame.image.width - frame.clip.x - frame.clip.width) / scale
  const bottom = (frame.image.y + frame.image.height - frame.clip.y - frame.clip.height) / scale
  const left = (frame.clip.x - frame.image.x) / scale

  return {
    transform: `translate(${frame.image.x - base.x}px, ${frame.image.y - base.y}px) scale(${scale})`,
    clipPath: `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${px(frame.radius / scale)})`,
  }
}

export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)

  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  }
}

function values(frame: FlightFrame) {
  return [
    frame.image.x,
    frame.image.y,
    frame.image.width,
    frame.image.height,
    frame.clip.x,
    frame.clip.y,
    frame.clip.width,
    frame.clip.height,
    frame.radius,
    frame.surface.x,
    frame.surface.y,
    frame.surface.width,
    frame.surface.height,
    frame.surfaceRadius,
    // In percent, so the landing threshold, a quarter of a unit, is as fine for it as for the pixels.
    frame.lift * 100,
  ]
}

function px(value: number) {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`
}

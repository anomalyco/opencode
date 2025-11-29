import type { ColorInput } from "@opentui/core"
import { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"

interface AdvancedGradientOptions {
  colors: ColorInput[]
  trailLength: number
  defaultColor?: ColorInput
  direction?: "forward" | "backward" | "bidirectional"
  holdFrames?: { start?: number; end?: number }
}

interface ScannerState {
  activePosition: number
  isHolding: boolean
  holdProgress: number
  holdTotal: number
  movementProgress: number
  movementTotal: number
  isMovingForward: boolean
}

function getScannerState(
  frameIndex: number,
  totalChars: number,
  options: Pick<AdvancedGradientOptions, "direction" | "holdFrames">,
): ScannerState {
  const { direction = "forward", holdFrames = {} } = options

  if (direction === "bidirectional") {
    const forwardFrames = totalChars
    const holdEndFrames = holdFrames.end ?? 0
    const backwardFrames = totalChars - 1

    if (frameIndex < forwardFrames) {
      // Moving forward
      return {
        activePosition: frameIndex,
        isHolding: false,
        holdProgress: 0,
        holdTotal: 0,
        movementProgress: frameIndex,
        movementTotal: forwardFrames,
        isMovingForward: true,
      }
    } else if (frameIndex < forwardFrames + holdEndFrames) {
      // Holding at end
      return {
        activePosition: totalChars - 1,
        isHolding: true,
        holdProgress: frameIndex - forwardFrames,
        holdTotal: holdEndFrames,
        movementProgress: 0,
        movementTotal: 0,
        isMovingForward: true,
      }
    } else if (frameIndex < forwardFrames + holdEndFrames + backwardFrames) {
      // Moving backward
      const backwardIndex = frameIndex - forwardFrames - holdEndFrames
      return {
        activePosition: totalChars - 2 - backwardIndex,
        isHolding: false,
        holdProgress: 0,
        holdTotal: 0,
        movementProgress: backwardIndex,
        movementTotal: backwardFrames,
        isMovingForward: false,
      }
    } else {
      // Holding at start
      return {
        activePosition: 0,
        isHolding: true,
        holdProgress: frameIndex - forwardFrames - holdEndFrames - backwardFrames,
        holdTotal: holdFrames.start ?? 0,
        movementProgress: 0,
        movementTotal: 0,
        isMovingForward: false,
      }
    }
  } else if (direction === "backward") {
    return {
      activePosition: totalChars - 1 - (frameIndex % totalChars),
      isHolding: false,
      holdProgress: 0,
      holdTotal: 0,
      movementProgress: frameIndex % totalChars,
      movementTotal: totalChars,
      isMovingForward: false,
    }
  } else {
    return {
      activePosition: frameIndex % totalChars,
      isHolding: false,
      holdProgress: 0,
      holdTotal: 0,
      movementProgress: frameIndex % totalChars,
      movementTotal: totalChars,
      isMovingForward: true,
    }
  }
}

function calculateColorIndex(
  frameIndex: number,
  charIndex: number,
  totalChars: number,
  options: Pick<AdvancedGradientOptions, "direction" | "holdFrames" | "trailLength">,
  state?: ScannerState,
): number {
  const { trailLength } = options
  const { activePosition, isHolding, holdProgress, isMovingForward } =
    state ?? getScannerState(frameIndex, totalChars, options)

  // Calculate directional distance (positive means trailing behind)
  const directionalDistance = isMovingForward
    ? activePosition - charIndex // For forward: trail is to the left (lower indices)
    : charIndex - activePosition // For backward: trail is to the right (higher indices)

  // Handle hold frame fading: keep the lead bright, fade the trail
  if (isHolding) {
    // Shift the color index by how long we've been holding
    return directionalDistance + holdProgress
  }

  // Normal movement - show gradient trail only behind the movement direction
  if (directionalDistance > 0 && directionalDistance < trailLength) {
    return directionalDistance
  }

  // At the active position, show the brightest color
  if (directionalDistance === 0) {
    return 0
  }

  return -1
}

function createKnightRiderTrail(options: AdvancedGradientOptions): ColorGenerator {
  const { colors, defaultColor } = options

  // Use the provided defaultColor if it's an RGBA instance, otherwise convert/default
  // We use RGBA.fromHex for the fallback to ensure we have an RGBA object.
  // Note: If defaultColor is a string, we convert it once here.
  const defaultRgba = defaultColor instanceof RGBA ? defaultColor : RGBA.fromHex((defaultColor as string) || "#000000")

  let cachedFrameIndex = -1
  let cachedState: ScannerState | null = null

  return (frameIndex: number, charIndex: number, _totalFrames: number, totalChars: number) => {
    if (frameIndex !== cachedFrameIndex) {
      cachedFrameIndex = frameIndex
      cachedState = getScannerState(frameIndex, totalChars, options)
    }

    const state = cachedState!

    const index = calculateColorIndex(frameIndex, charIndex, totalChars, options, state)

    // Calculate global fade for inactive dots during hold or movement
    const { isHolding, holdProgress, holdTotal, movementProgress, movementTotal } = state

    let alpha = 1.0
    if (isHolding && holdTotal > 0) {
      // Fade out linearly
      const progress = Math.min(holdProgress / holdTotal, 1)
      alpha = Math.max(0, 1 - progress)
    } else if (!isHolding && movementTotal > 0) {
      // Fade in linearly during movement
      const progress = Math.min(movementProgress / Math.max(1, movementTotal - 1), 1)
      alpha = progress
    }

    // Mutate the alpha of the default RGBA object
    // This assumes single-threaded, synchronous rendering per frame
    // where we can modify the state for the current frame.
    // Since this is run for every char in the frame, setting it repeatedly to the same value is fine.
    defaultRgba.a = alpha

    if (index === -1) {
      return defaultRgba
    }

    return colors[index] ?? defaultRgba
  }
}

/**
 * Derives a gradient of tail colors from a single bright color
 * @param brightColor The brightest color (center/head of the scanner)
 * @param steps Number of gradient steps (default: 6)
 * @returns Array of RGBA colors from brightest to darkest
 */
export function deriveTrailColors(brightColor: ColorInput, steps: number = 6): RGBA[] {
  const baseRgba = brightColor instanceof RGBA ? brightColor : RGBA.fromHex(brightColor as string)

  const colors: RGBA[] = []

  for (let i = 0; i < steps; i++) {
    // Progressive darkening:
    // i=0: 100% brightness (original color)
    // i=1: add slight bloom/glare (lighten)
    // i=2+: progressively darken
    let factor: number

    if (i === 0) {
      factor = 1.0 // Original brightness
    } else if (i === 1) {
      factor = 1.2 // Slight bloom/glare effect
    } else {
      // Exponential decay for natural-looking trail fade
      factor = Math.pow(0.6, i - 1)
    }

    const r = Math.min(1.0, baseRgba.r * factor)
    const g = Math.min(1.0, baseRgba.g * factor)
    const b = Math.min(1.0, baseRgba.b * factor)

    colors.push(RGBA.fromValues(r, g, b, 1.0))
  }

  return colors
}

/**
 * Derives the inactive/default color from a bright color
 * @param brightColor The brightest color (center/head of the scanner)
 * @param factor Brightness factor for inactive color (default: 0.2)
 * @returns A much darker version suitable for inactive dots
 */
export function deriveInactiveColor(brightColor: ColorInput, factor: number = 0.2): RGBA {
  const baseRgba = brightColor instanceof RGBA ? brightColor : RGBA.fromHex(brightColor as string)

  const r = baseRgba.r * factor
  const g = baseRgba.g * factor
  const b = baseRgba.b * factor

  return RGBA.fromValues(r, g, b, 1.0)
}

export type KnightRiderStyle = "blocks" | "diamonds"

export interface KnightRiderOptions {
  width?: number
  style?: KnightRiderStyle
  holdStart?: number
  holdEnd?: number
  colors?: ColorInput[]
  /** Single color to derive trail from (alternative to providing colors array) */
  color?: ColorInput
  /** Number of trail steps when using single color (default: 6) */
  trailSteps?: number
  defaultColor?: ColorInput
  /** Brightness factor for inactive color when using single color (default: 0.2) */
  inactiveFactor?: number
}

/**
 * Creates frame strings for a Knight Rider style scanner animation
 * @param options Configuration options for the Knight Rider effect
 * @returns Array of frame strings
 */
export function createFrames(options: KnightRiderOptions = {}): string[] {
  const width = options.width ?? 8
  const style = options.style ?? "diamonds"
  const holdStart = options.holdStart ?? 30
  const holdEnd = options.holdEnd ?? 9

  const colors =
    options.colors ??
    (options.color
      ? deriveTrailColors(options.color, options.trailSteps)
      : [
          RGBA.fromHex("#ff0000"), // Brightest Red (Center)
          RGBA.fromHex("#ff5555"), // Glare/Bloom
          RGBA.fromHex("#dd0000"), // Trail 1
          RGBA.fromHex("#aa0000"), // Trail 2
          RGBA.fromHex("#770000"), // Trail 3
          RGBA.fromHex("#440000"), // Trail 4
        ])

  const defaultColor =
    options.defaultColor ??
    (options.color ? deriveInactiveColor(options.color, options.inactiveFactor) : RGBA.fromHex("#330000"))

  const trailOptions = {
    colors,
    trailLength: colors.length,
    defaultColor,
    direction: "bidirectional" as const,
    holdFrames: { start: holdStart, end: holdEnd },
  }

  // Bidirectional cycle: Forward (width) + Hold End + Backward (width-1) + Hold Start
  const totalFrames = width + holdEnd + (width - 1) + holdStart

  // Generate dynamic frames where inactive pixels are dots and active ones are blocks
  const frames = Array.from({ length: totalFrames }, (_, frameIndex) => {
    return Array.from({ length: width }, (_, charIndex) => {
      const index = calculateColorIndex(frameIndex, charIndex, width, trailOptions)

      if (style === "diamonds") {
        const shapes = ["⬥", "◆", "⬩", "⬪"]
        if (index >= 0 && index < trailOptions.colors.length) {
          return shapes[Math.min(index, shapes.length - 1)]
        }
        return "·"
      }

      // Default to blocks
      // It's active if we have a valid color index that is within our colors array
      const isActive = index >= 0 && index < trailOptions.colors.length
      return isActive ? "■" : "⬝"
    }).join("")
  })

  return frames
}

/**
 * Creates a color generator function for Knight Rider style scanner animation
 * @param options Configuration options for the Knight Rider effect
 * @returns ColorGenerator function
 */
export function createColors(options: KnightRiderOptions = {}): ColorGenerator {
  const holdStart = options.holdStart ?? 30
  const holdEnd = options.holdEnd ?? 9

  const colors =
    options.colors ??
    (options.color
      ? deriveTrailColors(options.color, options.trailSteps)
      : [
          RGBA.fromHex("#ff0000"), // Brightest Red (Center)
          RGBA.fromHex("#ff5555"), // Glare/Bloom
          RGBA.fromHex("#dd0000"), // Trail 1
          RGBA.fromHex("#aa0000"), // Trail 2
          RGBA.fromHex("#770000"), // Trail 3
          RGBA.fromHex("#440000"), // Trail 4
        ])

  const defaultColor =
    options.defaultColor ??
    (options.color ? deriveInactiveColor(options.color, options.inactiveFactor) : RGBA.fromHex("#330000"))

  const trailOptions = {
    colors,
    trailLength: colors.length,
    defaultColor,
    direction: "bidirectional" as const,
    holdFrames: { start: holdStart, end: holdEnd },
  }

  return createKnightRiderTrail(trailOptions)
}

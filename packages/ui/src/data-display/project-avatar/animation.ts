import { observeReducedMotion, prefersReducedMotion } from "../../motion/reduced"
import {
  AVATAR_DISPOSED,
  AVATAR_POINTER_LEFT,
  AVATAR_REFRESH,
  createAvatarClock,
  INITIAL_AVATAR_ANIMATION_STATE,
  selectAvatarPaintTime,
  selectAvatarRunning,
  transitionAvatarAnimation,
  type AvatarAnimationEvent,
  type AvatarAnimationState,
} from "./animation-machine"
import { drawProjectIcon, type GeneratedProjectIcon } from "./generated"

const HOVER_TARGET = 'a, button, [role="menuitem"], [role="option"], [data-titlebar-tab]'

// Paints a generated avatar into `canvas`. The static frame is drawn once per icon and pixel size and copied into every
// avatar that shows it. Hover is tracked per rendered avatar, on the row or control that contains it, so hovering one
// row animates only that row's icon even when other rows show the same project. Only a hovered avatar runs an
// animation loop, and it stops once the icon has eased back to its static frame.
export function attachGeneratedAvatar(canvas: HTMLCanvasElement, icon: () => GeneratedProjectIcon) {
  let state: AvatarAnimationState = INITIAL_AVATAR_ANIMATION_STATE
  const clock = createAvatarClock()
  let frame = 0
  let stopMotionObserver: (() => void) | undefined
  // Reused every frame, so the loop allocates nothing.
  const enterEvent = { type: "pointer.entered" as const, now: 0, reduced: false }
  const frameEvent = { type: "frame" as const, now: 0 }
  const motionEvent = { type: "motion.changed" as const, reduced: false }

  const paint = (draw: (ctx: CanvasRenderingContext2D, px: number) => void) => {
    const px = Math.max(1, Math.round((canvas.clientWidth || 16) * (window.devicePixelRatio || 1)))

    if (canvas.width !== px) canvas.width = canvas.height = px
    const ctx = canvas.getContext("2d")

    if (ctx) draw(ctx, px)
  }

  const drawStatic = (ctx: CanvasRenderingContext2D, px: number) => {
    ctx.clearRect(0, 0, px, px)
    const still = staticFrame(icon(), px)

    if (still) ctx.drawImage(still, 0, 0)
  }

  const drawAnimated = (ctx: CanvasRenderingContext2D, px: number) =>
    drawProjectIcon(ctx, px, icon(), selectAvatarPaintTime(state, clock))

  const dispatch = (event: AvatarAnimationEvent) => {
    const prev = state
    const next = transitionAvatarAnimation(prev, clock, event)
    state = next.state

    if (selectAvatarRunning(prev) !== selectAvatarRunning(state)) reconcile()

    if (next.effect === "paint-static") paint(drawStatic)

    if (next.effect === "paint-frame") paint(drawAnimated)
  }

  const reconcile = () => {
    if (selectAvatarRunning(state)) {
      stopMotionObserver = observeReducedMotion(onMotionChange)
      frame = requestAnimationFrame(tick)

      return
    }

    cancelAnimationFrame(frame)
    frame = 0
    stopMotionObserver?.()
    stopMotionObserver = undefined
  }

  const tick = (now: number) => {
    frame = 0
    frameEvent.now = now
    dispatch(frameEvent)

    if (selectAvatarRunning(state) && !frame) frame = requestAnimationFrame(tick)
  }

  const enter = () => {
    enterEvent.now = performance.now()
    enterEvent.reduced = prefersReducedMotion()
    dispatch(enterEvent)
  }

  const leave = () => dispatch(AVATAR_POINTER_LEFT)

  const onMotionChange = () => {
    motionEvent.reduced = prefersReducedMotion()
    dispatch(motionEvent)
  }

  const target =
    canvas.closest<HTMLElement>(HOVER_TARGET) ??
    canvas.closest<HTMLElement>('[data-component="project-avatar-v2"]') ??
    canvas

  target.addEventListener("pointerenter", enter)
  target.addEventListener("pointerleave", leave)

  return {
    /** Repaints the static frame unless the avatar is animating, e.g. after the icon changed. */
    refresh: () => dispatch(AVATAR_REFRESH),
    dispose: () => {
      dispatch(AVATAR_DISPOSED)
      target.removeEventListener("pointerenter", enter)
      target.removeEventListener("pointerleave", leave)
    },
  }
}

const frames = new Map<string, HTMLCanvasElement | undefined>()

function staticFrame(icon: GeneratedProjectIcon, px: number) {
  const key = `${JSON.stringify(icon)}|${px}`

  if (frames.has(key)) return frames.get(key)

  if (frames.size > 256) frames.clear()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = px
  const ctx = canvas.getContext("2d")

  if (ctx) drawProjectIcon(ctx, px, icon, 0)
  frames.set(key, ctx ? canvas : undefined)

  return frames.get(key)
}

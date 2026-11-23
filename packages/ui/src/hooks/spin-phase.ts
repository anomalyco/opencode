import { onCleanup } from "solid-js"

type PinnableAnimation = {
  startTime: CSSNumberish | null
  playState?: AnimationPlayState
  effect: { getTiming(): EffectTiming; target?: Element | null } | null
}

// Coalesce resize, visibility and animationstart callbacks into one pass per frame so bursts of mounting or scrolling
// spinners flush style at most once instead of once per spinner or per bubbling child animation.
const pending = new Set<Element>()

let frame = 0

function schedulePin(el: Element) {
  if (el.hasAttribute("data-offscreen")) return
  pending.add(el)

  if (frame) return

  if (typeof requestAnimationFrame === "undefined") {
    flushPending()

    return
  }

  frame = requestAnimationFrame(flushPending)
}

function flushPending() {
  frame = 0
  const targets = [...pending].filter((el) => el.isConnected && !el.hasAttribute("data-offscreen"))
  pending.clear()

  if (targets.length === 0) return

  if (targets.length > 1 && typeof document !== "undefined" && document.getAnimations) {
    const owned = new Set(targets)
    pinAnimations(document.getAnimations().filter((animation) => isInsideAny(animationTarget(animation), owned)))

    return
  }

  targets.forEach((target) => pinSpinPhase(target))
}

function animationTarget(animation: PinnableAnimation) {
  const effect = animation.effect

  if (!effect || !("target" in effect)) return null

  return effect.target instanceof Element ? effect.target : null
}

function isInsideAny(node: Element | null, roots: ReadonlySet<Element>) {
  let current = node

  while (current) {
    if (roots.has(current)) return true
    current = current.parentElement
  }

  return false
}

// ResizeObserver delivers after style and layout but before paint, so a spinner that mounts or leaves `display: none`
// (which restarts its CSS animation) paints its first frame already in phase.
const resize =
  typeof ResizeObserver === "undefined"
    ? undefined
    : new ResizeObserver((entries) => entries.forEach((entry) => schedulePin(entry.target)))

// Spinners scrolled or clipped out of view, under a `display: none` or `content-visibility: hidden` ancestor, or sized
// to nothing get `data-offscreen`, which their CSS uses to pause. Coming back, they resume and re-pin to the shared
// phase. Toggle every attribute first so style writes are never interleaved with `getAnimations()` reads.
const visibility =
  typeof IntersectionObserver === "undefined"
    ? undefined
    : new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          entry.target.toggleAttribute("data-offscreen", !entry.isIntersecting)
        })
        entries.forEach((entry) => {
          if (entry.isIntersecting) schedulePin(entry.target)
        })
      })

/** Use as a `ref` on a looping indicator so every instance on screen shares one phase and pauses while hidden. */
export function syncSpinPhase(el: Element) {
  const onStart = () => schedulePin(el)
  resize?.observe(el)
  visibility?.observe(el)
  // Turning reduced motion back off or reordering DOM restarts the animation without resizing anything.
  el.addEventListener("animationstart", onStart)
  onCleanup(() => {
    pending.delete(el)
    el.removeEventListener("animationstart", onStart)
    resize?.unobserve(el)
    visibility?.unobserve(el)
  })
}

// Starting every infinite loop at the document timeline's origin puts all instances of one animation in phase.
// Check cheap properties first so already-pinned or paused animations never allocate an EffectTiming dictionary.
export function pinSpinPhase(el: { getAnimations(options: GetAnimationsOptions): PinnableAnimation[] }) {
  pinAnimations(el.getAnimations({ subtree: true }))
}

function pinAnimations(animations: readonly PinnableAnimation[]) {
  animations.forEach((animation) => {
    if (animation.startTime === 0 || animation.playState === "paused") return

    if (animation.effect?.getTiming().iterations !== Infinity) return
    animation.startTime = 0
  })
}

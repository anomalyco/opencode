import { onCleanup, onMount } from "solid-js"

const PATTERNS = '[data-page="stats"] [data-slot$="-pattern"]'

// Speeds are px/s and times are seconds. Each ring is a bright front with a trail that decays by the time since the
// front passed, so dots keep glowing briefly after the wave moves on. The optional cursor trail lights a few dots under
// the pointer that fade the same way.
export const RIPPLE = {
  speed: 480,
  minTravel: 0.9,
  maxTravel: 2.6,
  ease: 1.6,
  reach: 1.1,
  decay: 0.45,
  soft: 6,
  falloff: 1.2,
  brightness: 30,
  rings: 1,
  gap: 0.2,
  ratio: 0.55,
  color: "var(--stats-text)",
  tint: "var(--stats-text)",
  trail: false,
  trailRadius: 28,
  trailBrightness: 20,
  trailDecay: 0.35,
  trailSpacing: 12,
}

type Ripple = { x: number; y: number; radius: number; travel: number; start: number; retired?: number }
type Glow = { x: number; y: number; start: number; retired?: number }
type Light = { ripples: Ripple[]; glows: Glow[] }

// Past these counts on one pattern, the oldest fades out quickly so bursts of clicks or fast moves stay cheap to draw.
const LIMIT = { waves: 6, glows: 24, retire: 0.15 }

// Clicking the visible dots of a pattern sends a wave of light across them. Waves overlap instead of replacing each other.
export function PatternRipple() {
  onMount(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    const lights = new Map<HTMLElement, Light>()
    const state = { running: false }

    const frame = (now: number) => {
      lights.forEach((light, el) => {
        const ripples = light.ripples.filter((ripple) => !finished(ripple, now, reduced))
        const glows = light.glows.filter((glow) => !glowFinished(glow, now))
        if (ripples.length + glows.length === 0) {
          lights.delete(el)
          el.style.removeProperty("--dot-ripple")
          return
        }
        lights.set(el, { ripples, glows })
        el.style.setProperty(
          "--dot-ripple",
          [
            ...glows.map((glow) => glowGradient(glow, now)),
            ...ripples.map((ripple) => rippleGradient(ripple, now, reduced)),
          ].join(", "),
        )
      })
      state.running = lights.size > 0
      if (state.running) requestAnimationFrame(frame)
    }

    const wake = () => {
      if (state.running) return
      state.running = true
      requestAnimationFrame(frame)
    }

    const lightFor = (el: HTMLElement) => lights.get(el) ?? lights.set(el, { ripples: [], glows: [] }).get(el)!

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      const hit = patternAt(event)
      if (!hit) return
      const box = hit.getBoundingClientRect()
      const visible = visibleBox(hit)
      const radius =
        Math.hypot(
          Math.max(event.clientX - visible.left, visible.right - event.clientX),
          Math.max(event.clientY - visible.top, visible.bottom - event.clientY),
        ) * RIPPLE.reach
      const now = performance.now()
      const target = lightFor(hit)
      target.ripples.push({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        radius,
        travel: Math.min(RIPPLE.maxTravel, Math.max(RIPPLE.minTravel, radius / RIPPLE.speed)),
        start: now,
      })
      retire(target.ripples, LIMIT.waves, now)
      wake()
    }

    // New trail points are spaced out along the path, so a fast move adds a few points rather than one per event.
    const move = (event: PointerEvent) => {
      if (!RIPPLE.trail || reduced || event.pointerType === "touch") return
      const hit = patternAt(event)
      if (!hit) return
      const box = hit.getBoundingClientRect()
      const x = event.clientX - box.left
      const y = event.clientY - box.top
      const target = lightFor(hit)
      const last = target.glows.at(-1)
      if (last && Math.hypot(x - last.x, y - last.y) < RIPPLE.trailSpacing) return
      const now = performance.now()
      target.glows.push({ x, y, start: now })
      retire(target.glows, LIMIT.glows, now)
      wake()
    }

    document.addEventListener("pointerdown", down, { passive: true })
    document.addEventListener("pointermove", move, { passive: true })
    onCleanup(() => {
      document.removeEventListener("pointerdown", down)
      document.removeEventListener("pointermove", move)
    })
  })

  return null
}

// The pattern must be the top element under the pointer, so text cut-outs over a pattern don't count.
function patternAt(event: PointerEvent) {
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  if (hit instanceof HTMLElement && hit.matches(PATTERNS)) return hit
}

function retire(list: { retired?: number }[], limit: number, now: number) {
  list
    .filter((item) => item.retired === undefined)
    .slice(0, -limit)
    .forEach((item) => (item.retired = now))
}

function retiring(item: { retired?: number }, now: number) {
  if (item.retired === undefined) return 1
  return Math.max(0, 1 - (now - item.retired) / 1000 / LIMIT.retire)
}

function glowFinished(glow: Glow, now: number) {
  return retiring(glow, now) === 0 || (now - glow.start) / 1000 >= RIPPLE.trailDecay * 4
}

function glowGradient(glow: Glow, now: number) {
  const alpha = RIPPLE.trailBrightness * Math.exp(-(now - glow.start) / 1000 / RIPPLE.trailDecay) * retiring(glow, now)
  const mix = (amount: number) =>
    `color-mix(in srgb, ${RIPPLE.tint} ${(Number.isFinite(amount) ? Math.min(100, Math.max(0, amount)) : 0).toFixed(1)}%, transparent)`
  const r = RIPPLE.trailRadius
  return `radial-gradient(circle at ${glow.x.toFixed(1)}px ${glow.y.toFixed(1)}px, ${mix(alpha)} 0px, ${mix(alpha / 2)} ${(r * 0.45).toFixed(1)}px, transparent ${r}px)`
}

const STILL = { radius: 72, duration: 0.2 }

function finished(ripple: Ripple, now: number, reduced: boolean) {
  if (retiring(ripple, now) === 0) return true
  const t = (now - ripple.start) / 1000
  if (reduced) return t >= STILL.duration
  return t >= ripple.travel + (RIPPLE.rings - 1) * RIPPLE.gap + RIPPLE.decay * 5
}

function rippleGradient(ripple: Ripple, now: number, reduced: boolean) {
  const t = (now - ripple.start) / 1000
  const fading = retiring(ripple, now)
  // One invalid stop makes the browser drop every layer in --dot-ripple, so amounts are always finite.
  const mix = (color: string, amount: number) => {
    const percent = Number.isFinite(amount) ? Math.min(100, Math.max(0, amount * fading)) : 0
    return `color-mix(in srgb, ${color} ${percent.toFixed(1)}%, transparent)`
  }
  const at = `circle at ${ripple.x.toFixed(1)}px ${ripple.y.toFixed(1)}px`
  // Reduced motion keeps a brief glow at the click without any travel.
  if (reduced) {
    const alpha = RIPPLE.brightness * (1 - t / STILL.duration)
    return `radial-gradient(${at}, ${mix(RIPPLE.color, alpha)} 0px, transparent ${STILL.radius}px)`
  }

  const fronts = Array.from({ length: RIPPLE.rings }, (_, k) => t - k * RIPPLE.gap)
    .filter((local) => local > 0)
    .map((local) => ({
      r: front(ripple, local),
      width: front(ripple, local) - front(ripple, local - RIPPLE.decay),
    }))
  if (fronts.length === 0) return "none"
  const outer = Math.max(...fronts.map((item) => item.r)) + RIPPLE.soft
  const samples = [
    ...Array.from({ length: 24 }, (_, i) => (outer * i) / 23),
    ...fronts.flatMap((item) => [
      item.r + RIPPLE.soft,
      item.r,
      ...[0.15, 0.35, 0.6, 1, 1.5, 2.2, 3.2, 4.5].map((m) => item.r - item.width * m),
    ]),
  ]
    .filter((d) => d >= 0 && d <= outer)
    .sort((a, b) => a - b)

  const stops = samples.map((d) => {
    const light = intensity(ripple, d, t)
    const color = light.fresh ? RIPPLE.color : RIPPLE.tint
    return `${mix(color, RIPPLE.brightness * light.value)} ${d.toFixed(1)}px`
  })
  return `radial-gradient(${at}, ${stops.join(", ")}, transparent ${(outer + 1).toFixed(1)}px)`
}

function front(ripple: Ripple, local: number) {
  const progress = Math.min(1, Math.max(0, local / ripple.travel))
  return ripple.radius * (1 - (1 - progress) ** RIPPLE.ease)
}

// The inverse of `front`: when the wave reached distance `d`. The wave stops at its radius.
function passed(ripple: Ripple, d: number) {
  return ripple.travel * (1 - (1 - Math.min(1, d / ripple.radius)) ** (1 / RIPPLE.ease))
}

function intensity(ripple: Ripple, d: number, t: number) {
  const fade = Math.max(0, 1 - d / ripple.radius) ** RIPPLE.falloff
  const rings = Array.from({ length: RIPPLE.rings }, (_, k) => {
    const local = t - k * RIPPLE.gap
    if (local <= 0) return { value: 0, age: Infinity }
    const r = front(ripple, local)
    const strength = RIPPLE.ratio ** k * fade
    if (d > r) return { value: strength * Math.max(0, 1 - (d - r) / RIPPLE.soft), age: 0 }
    const age = local - passed(ripple, d)
    return { value: strength * Math.exp(-age / RIPPLE.decay), age }
  })
  return {
    value: Math.min(
      1,
      rings.reduce((sum, ring) => sum + ring.value, 0),
    ),
    fresh: Math.min(...rings.map((ring) => ring.age)) < RIPPLE.decay * 0.5,
  }
}

// Some patterns are larger than their clipping container, so the ripple only needs to reach the visible part.
function visibleBox(el: HTMLElement) {
  const box = el.getBoundingClientRect()
  const clip = el.parentElement?.getBoundingClientRect() ?? box
  return {
    left: Math.max(box.left, clip.left),
    top: Math.max(box.top, clip.top),
    right: Math.min(box.right, clip.right),
    bottom: Math.min(box.bottom, clip.bottom),
  }
}

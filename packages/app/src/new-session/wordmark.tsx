import { Logo } from "@opencode/ui/logo"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { For, onCleanup, onMount, Show } from "solid-js"
import { PinSound } from "./pin-sound"
import "./wordmark.css"

// Each letter in the 234×42 logo viewBox, with its counter shadow, stem, and bottom-centre pivot.
const LETTERS = [
  {
    cx: 12,
    weak: "M18 30H6V18H18V30Z",
    fill: "var(--icon-base)",
    stem: "M18 12H6V30H18V12ZM24 36H0V6H24V36Z",
  },
  {
    cx: 42,
    weak: "M48 30H36V18H48V30Z",
    fill: "var(--icon-base)",
    stem: "M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z",
  },
  {
    cx: 72,
    weak: "M84 24V30H66V24H84Z",
    fill: "var(--icon-base)",
    stem: "M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z",
  },
  {
    cx: 102,
    weak: "M108 36H96V18H108V36Z",
    fill: "var(--icon-base)",
    stem: "M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z",
  },
  {
    cx: 132,
    weak: "M144 30H126V18H144V30Z",
    fill: "var(--icon-strong-base)",
    stem: "M144 12H126V30H144V36H120V6H144V12Z",
  },
  {
    cx: 162,
    weak: "M168 30H156V18H168V30Z",
    fill: "var(--icon-strong-base)",
    stem: "M168 12H156V30H168V12ZM174 36H150V6H174V36Z",
  },
  {
    cx: 192,
    weak: "M198 30H186V18H198V30Z",
    fill: "var(--icon-strong-base)",
    stem: "M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z",
  },
  {
    cx: 222,
    weak: "M234 24V30H216V24H234Z",
    fill: "var(--icon-strong-base)",
    stem: "M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z",
  },
] as const

// Lodger geometry, in the logo's 234×42 viewBox units. The lodger is drawn from its bottom centre.
const W = 234
const H = 42
const HOLE = { x: 222, y: 15 }
const REST = { x: 222, y: 21 }
const PIN_SLOT = { x: 226.5, y: 10.5 }
const GROUND = 36
const HOME = 246
const POP = 26
const SLIP = 60
const HOLE_MAGNET = 24

type Phase = "hidden" | "drag" | "snap" | "show" | "idle" | "hop" | "carry" | "return" | "pack" | "game"

/** The lodger curled up as the brick breaker ball. Positions are the ball's centre, relative to the new session panel. */
export type LodgerBall = {
  radius: () => number
  at: () => { x: number; y: number }
  place: (
    x: number,
    y: number,
    pose: { look: number; lookAngle: number; stretch: number; angle: number; squint: number; curl: number },
  ) => void
  blink: () => void
  /** Uncurls and hops back to its perch beside the pin board. */
  done: () => void
}

type LetterPose = {
  x: number
  y: number
  sx: number
  sy: number
  opacity: number
}

type Parts = {
  box: HTMLDivElement
  stage: HTMLDivElement
  svg: SVGSVGElement
  flat: HTMLDivElement
  notch: SVGRectElement
  letters: SVGGElement[]
  grip: HTMLDivElement
  neck: SVGLineElement
  pin: SVGGElement
  critter: SVGGElement
  body: SVGRectElement
  eyes: SVGGElement
  blink: SVGGElement
}

/**
 * Reserves the wordmark's space. With `pins`, `NewSessionPinBoard` draws the logo into it. Otherwise it shows
 * the flat logo, and something lives in the top counter of the final "e".
 */
export function NewSessionWordmark(props: {
  ref: (element: HTMLDivElement) => void
  pins?: boolean
  sound?: () => boolean
  onOpen?: () => void
  onClose?: () => void
  onFlat?: () => void
  onPlay?: (ball: LodgerBall) => void
}) {
  // Read once: the lodger stays mounted after handing over to the pin board, and can be dragged back into the hole.
  const lodger = !props.pins
  let box!: HTMLDivElement

  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px] text-v2-background-bg-inverse"
    >
      <div
        ref={(el) => {
          box = el
          props.ref(el)
        }}
        data-slot="wordmark-box"
        class="relative mx-auto aspect-[234/42] w-4/5"
      >
        <Show when={lodger}>
          <WordmarkLodger
            box={box}
            sound={props.sound ?? (() => false)}
            onOpen={() => props.onOpen?.()}
            onClose={() => props.onClose?.()}
            onFlat={() => props.onFlat?.()}
            onPlay={props.onPlay}
          />
        </Show>
      </div>
    </div>
  )
}

/**
 * Eyes peek out of the "e" when the pointer comes near. Dragging them pulls the lodger and a single corner pin
 * out on a stretchy neck; pull far enough and that pin triggers an elastic 3D pull-wave across the wordmark.
 * Dragging the lodger back into the "e" hole reels all the pins back into the flat wordmark.
 */
function WordmarkLodger(props: {
  box: HTMLDivElement
  sound: () => boolean
  onOpen: () => void
  onClose: () => void
  onFlat: () => void
  onPlay?: (ball: LodgerBall) => void
}) {
  let stage!: HTMLDivElement
  let svg!: SVGSVGElement
  let flat!: HTMLDivElement
  let notch!: SVGRectElement
  let grip!: HTMLDivElement
  let neck!: SVGLineElement
  let pin!: SVGGElement
  let critter!: SVGGElement
  let body!: SVGRectElement
  let eyes!: SVGGElement
  let blink!: SVGGElement
  const letters: SVGGElement[] = []

  onMount(() =>
    onCleanup(
      mountLodger(
        { box: props.box, stage, svg, flat, notch, letters, grip, neck, pin, critter, body, eyes, blink },
        props.sound,
        props.onOpen,
        props.onClose,
        props.onFlat,
        props.onPlay,
      ),
    ),
  )

  return (
    <div ref={stage} class="absolute">
      <div ref={flat} data-slot="wordmark-flat" class="absolute inset-0">
        <svg viewBox="0 0 234 42" fill="none" class="block size-full overflow-visible">
          <For each={LETTERS}>
            {(item, i) => (
              <g ref={(el) => (letters[i()] = el)}>
                <g class="opacity-[0.16]">
                  <path d={item.weak} fill="var(--icon-weak-base)" />
                  <path d={item.stem} fill={item.fill} />
                </g>
                <Show when={i() === 7}>
                  <rect
                    ref={notch}
                    x="224.6"
                    y="8.6"
                    width="3.8"
                    height="3.8"
                    fill="var(--v2-background-bg-base)"
                    style={{ opacity: 0 }}
                  />
                </Show>
              </g>
            )}
          </For>
        </svg>
        <Logo class="wordmark-shimmer absolute inset-0 size-full" />
      </div>
      <svg
        ref={svg}
        data-slot="wordmark-lodger"
        viewBox="0 0 234 42"
        class="absolute inset-0 size-full overflow-visible"
      >
        <line ref={neck} stroke="var(--lodger-body)" stroke-linecap="round" style={{ opacity: 0 }} />
        <g ref={pin} style={{ opacity: 0 }}>
          <polygon points="-1.9,-1.9 1.9,-1.9 3.6,0.5 -0.2,0.5" fill="var(--lodger-side)" />
          <polygon points="1.9,-1.9 3.6,0.5 3.6,4.3 1.9,1.9" fill="var(--lodger-side)" />
          <rect x="-1.9" y="-1.9" width="3.8" height="3.8" rx="0.45" fill="var(--lodger-eye)" />
        </g>
        <g ref={critter}>
          <rect
            ref={body}
            x="-6"
            y="-10"
            width="12"
            height="10"
            rx="1.5"
            fill="var(--lodger-body)"
            style={{ opacity: 0 }}
          />
          <g ref={eyes} style={{ opacity: 0 }}>
            <g ref={blink} data-slot="lodger-blink">
              <rect x="-3.5" y="-7.3" width="2" height="2.6" rx="0.5" fill="var(--lodger-eye)" />
              <rect x="1.5" y="-7.3" width="2" height="2.6" rx="0.5" fill="var(--lodger-eye)" />
            </g>
          </g>
        </g>
      </svg>
      <div
        ref={grip}
        data-slot="wordmark-lodger-grip"
        class="pointer-events-auto absolute cursor-grab touch-none active:cursor-grabbing"
      />
    </div>
  )
}

function mountLodger(
  parts: Parts,
  sound: () => boolean,
  onOpen: () => void,
  onClose: () => void,
  onFlat: () => void,
  onPlay?: (ball: LodgerBall) => void,
) {
  const still = prefersReducedMotion()
  const poses: LetterPose[] = LETTERS.map(() => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1 }))
  const c = {
    phase: "hidden" as Phase,
    now: 0,
    t0: 0,
    cue: 0,
    x: REST.x,
    y: REST.y,
    vx: 0,
    vy: 0,
    fromX: REST.x,
    fromY: REST.y,
    rot: 0,
    crouch: 0,
    body: 0,
    neck: 0,
    eyes: 0,
    near: 0,
    lookX: 0,
    lookY: 0,
    wide: 1,
    squint: 1,
    notch: 0,
    pinOpacity: 0,
    pinX: PIN_SLOT.x,
    pinY: PIN_SLOT.y,
    pinRot: 0,
    pinScale: 1,
    ball: 0,
    stretch: 0,
    angle: 0,
    dur: 0.34,
    arc: 10,
  }
  const pointer = { x: HOLE.x, y: HOLE.y, inside: false, downX: HOLE.x, downY: HOLE.y }
  const impacts: { at: number; amp: number }[] = []
  const timers = { raf: 0, blink: 0, last: 0 }
  const panel = parts.box.closest<HTMLElement>('[data-component="new-session"]') ?? document.documentElement
  // The lodger's screen rect, read on resize and pointer entry so pointer moves never force a layout.
  const rect = { left: 0, top: 0, scale: 1, px: 0, py: 0 }
  // The composer, in lodger units while carrying; dropping the lodger on it starts the brick breaker.
  const drop = { el: undefined as HTMLElement | undefined, l: 0, t: 0, r: 0, b: 0, over: false }
  // Last written DOM values, so frames and pointer moves only touch what changed.
  const written = new Map<string, string>()
  const put = (key: string, write: (value: string) => void, value: string) => {
    if (written.get(key) === value) return
    written.set(key, value)
    write(value)
  }
  const measure = () => {
    const r = parts.svg.getBoundingClientRect()
    rect.left = r.left
    rect.top = r.top
    rect.scale = r.width / W || 1
    const p = panel.getBoundingClientRect()
    rect.px = r.left - p.left
    rect.py = r.top - p.top
  }

  // Snaps the flat wordmark stage to the exact integer-pitch footprint and rounded origin used by `NewSessionPinBoard`.
  const fitStage = () => {
    const l = parts.box.getBoundingClientRect()
    if (!l.width) return
    const s = parts.box.closest('[data-component="new-session"]')?.getBoundingClientRect()
    const pitch = Math.max(3, Math.round(l.width / 78))
    const x = s ? Math.round(l.left - s.left + (l.width - pitch * 78) / 2) - (l.left - s.left) : (l.width - pitch * 78) / 2
    const y = s ? Math.round(l.top - s.top + (l.height - pitch * 14) / 2) - (l.top - s.top) : (l.height - pitch * 14) / 2
    parts.stage.style.left = `${x}px`
    parts.stage.style.top = `${y}px`
    parts.stage.style.width = `${pitch * 78}px`
    parts.stage.style.height = `${pitch * 14}px`
    measure()
  }

  // Moves the interactive hit box between the "e" counter (when hidden) and HOME (when perched beside the board).
  const placeGrip = (where: "hidden" | "idle" | "none") => {
    if (where === "none") {
      parts.grip.style.display = "none"
      return
    }
    parts.grip.style.display = ""
    const box = where === "hidden" ? { x: 213, y: 8, w: 18, h: 14 } : { x: 234, y: 18, w: 24, h: 24 }
    parts.grip.style.left = `${(box.x / W) * 100}%`
    parts.grip.style.top = `${(box.y / H) * 100}%`
    parts.grip.style.width = `${(box.w / W) * 100}%`
    parts.grip.style.height = `${(box.h / H) * 100}%`
  }

  const resetPoses = (opacity = 1) => {
    for (const p of poses) Object.assign(p, { x: 0, y: 0, sx: 1, sy: 1, opacity })
  }

  const wake = () => {
    if (timers.raf) return
    timers.last = performance.now() / 1000 - 1 / 60
    timers.raf = requestAnimationFrame(frame)
  }

  const frame = (ms: number) => {
    timers.raf = 0
    c.now = ms / 1000
    const dt = Math.min(1 / 30, Math.max(1 / 240, c.now - timers.last))
    timers.last = c.now
    if (c.phase === "drag") dragOut(dt)
    if (c.phase === "snap") snapIn(dt)
    if (c.phase === "show") show(c.now - c.t0)
    if (c.phase === "hop") hop(c.now - c.t0)
    if (c.phase === "carry") dragCarry(dt)
    if (c.phase === "return") returnHome(c.now - c.t0)
    if (c.phase === "pack") pack(c.now - c.t0)
    render()
    if (c.phase !== "hidden" && c.phase !== "idle" && c.phase !== "game") timers.raf = requestAnimationFrame(frame)
  }

  const dragOut = (dt: number) => {
    const dx = pointer.x - pointer.downX
    const dy = pointer.y - pointer.downY
    const pull = Math.hypot(dx, dy)
    if (pull > SLIP) return pop()
    const give = 1 / (1 + pull / 40)
    const ease = 1 - Math.exp(-dt * 30)
    c.x += (REST.x + dx * give - c.x) * ease
    c.y += (REST.y + dy * give - c.y) * ease
    const out = Math.hypot(c.x - REST.x, c.y - REST.y)
    const stress = clamp01(pull / POP)
    c.body = clamp01(out / 4.5)
    c.neck = c.body
    c.eyes = 1
    c.wide = 1 + stress * 0.32
    c.rot = clamp((c.x - REST.x) * 2, 24)
    c.crouch = -clamp01(out / 20) * 0.18
    c.lookX = clamp(dx / 15, 1)
    c.lookY = clamp(dy / 15, 1) * 0.6
    c.notch = clamp01(out / 3)
    c.pinOpacity = c.notch
    c.pinX = lerp(PIN_SLOT.x, c.x - 1.5, clamp01(out / 7))
    c.pinY = lerp(PIN_SLOT.y, c.y - 11, clamp01(out / 7))
    c.pinRot = (c.x - REST.x) * 2.5
    c.pinScale = 1 + stress * 0.35
    poses[7].x = (c.x - REST.x) * 0.12
    poses[7].y = (c.y - REST.y) * 0.12
    poses[7].sx = 1 + stress * 0.05
    poses[7].sy = 1 + stress * 0.05
  }

  const snapIn = (dt: number) => {
    c.vx += (-(c.x - REST.x) * 420 - c.vx * 18) * dt
    c.vy += (-(c.y - REST.y) * 420 - c.vy * 18) * dt
    c.x += c.vx * dt
    c.y += c.vy * dt
    const out = Math.hypot(c.x - REST.x, c.y - REST.y)
    const fade = Math.exp(-dt * 10)
    c.body = clamp01(out / 4.5)
    c.neck = c.body
    c.notch *= fade
    c.pinOpacity *= fade
    c.rot *= fade
    c.crouch *= fade
    c.wide = 1 + (c.wide - 1) * fade
    for (const p of poses) {
      p.x *= fade
      p.y *= fade
      p.sx = 1 + (p.sx - 1) * fade
      p.sy = 1 + (p.sy - 1) * fade
    }
    if (out > 0.05 || Math.hypot(c.vx, c.vy) > 0.5) return
    restHidden()
    if (sound()) PinSound.slot(70, 78, c.x, W)
    blinkOnce()
  }

  const restHidden = () => {
    resetPoses(1)
    parts.flat.style.display = ""
    placeGrip("hidden")
    Object.assign(c, {
      phase: "hidden",
      x: REST.x,
      y: REST.y,
      vx: 0,
      vy: 0,
      rot: 0,
      crouch: 0,
      wide: 1,
      squint: 1,
      body: 0,
      neck: 0,
      notch: 0,
      pinOpacity: 0,
      ball: 0,
      stretch: 0,
      eyes: c.near * 0.55,
    })
    look()
  }

  const pop = () => {
    c.now = performance.now() / 1000
    Object.assign(c, {
      phase: "show",
      t0: c.now,
      cue: 0,
      fromX: c.x,
      fromY: c.y,
      neck: 0,
    })
    placeGrip("none")
    onOpen()
    if (sound()) PinSound.knock(c.x, W)
    if (still) return settleIdle()
    wake()
  }

  const showCues = [
    { at: 0.45, run: () => land(0.38) },
    {
      at: 0.95,
      run: () => {
        parts.flat.style.display = "none"
      },
    },
    {
      at: 1.35,
      run: () => {
        if (sound()) PinSound.slot(75, 78, PIN_SLOT.x, W)
      },
    },
    { at: 1.72, run: () => land(0.32) },
    { at: 1.95, run: () => blinkOnce() },
  ]

  // Pulling one single pin out of the "e" triggers an elastic 3D pull-wave that pops every pin out toward
  // the viewer from right to left, then the lodger hops up to slot its starter pin back in.
  const show = (t: number) => {
    while (c.cue < showCues.length && t >= showCues[c.cue].at) showCues[c.cue++].run()
    if (t >= 2.15) return settleIdle()
    Object.assign(c, { rot: 0, crouch: 0, wide: 1, squint: 1, lookX: -1, lookY: 0, body: 1, eyes: 1 })
    c.notch = t < 1.35 ? 1 : 0
    c.pinOpacity = t < 1.35 ? 1 : 0

    poses.forEach((p, i) => {
      const start = (7 - i) * 0.08
      const u = seg(t, start, start + 0.28)
      p.opacity = 1 - u
      p.x = 0
      p.y = 0
    })

    if (t < 0.45) {
      const u = t / 0.45
      c.x = lerp(c.fromX, HOME, easeOut(u))
      c.y = lerp(c.fromY, GROUND, u) - Math.sin(Math.PI * u) * 20
      c.rot = 360 * easeInOut(u)
      c.wide = 1.35
      c.pinX = c.x - 1
      c.pinY = c.y - 13
      c.pinRot = u * 360
      c.pinScale = 1.4
      return
    }
    if (t < 1.05) {
      c.x = HOME
      c.y = GROUND
      c.lookX = -1
      c.pinX = c.x
      c.pinY = c.y - 12.5 - Math.sin(t * 8) * 0.8
      c.pinRot = Math.sin(t * 5) * 10
      c.pinScale = 1.3
      return
    }
    if (t < 1.35) {
      const u = seg(t, 1.05, 1.35)
      c.x = lerp(HOME, 233, easeInOut(u))
      c.y = lerp(GROUND, 18, easeOut(u)) - Math.sin(Math.PI * u) * 7
      c.pinX = lerp(HOME, PIN_SLOT.x, easeInOut(u))
      c.pinY = lerp(GROUND - 12.5, PIN_SLOT.y, easeInOut(u))
      c.pinRot = 0
      c.pinScale = lerp(1.3, 1, u)
      return
    }
    const u = seg(t, 1.35, 1.72)
    c.x = lerp(233, HOME, easeInOut(u))
    c.y = lerp(18, GROUND, u) - Math.sin(Math.PI * u) * 10
    c.squint = t > 1.72 ? 0.35 : 1
  }

  const settleIdle = () => {
    resetPoses(0)
    parts.flat.style.display = "none"
    placeGrip("idle")
    Object.assign(c, {
      phase: "idle",
      x: HOME,
      y: GROUND,
      rot: 0,
      crouch: 0,
      wide: 1,
      squint: 1,
      body: 1,
      eyes: 1,
      neck: 0,
      notch: 0,
      pinOpacity: 0,
      ball: 0,
      stretch: 0,
    })
    look()
    render()
    scheduleBlink()
  }

  // Carrying the lodger from HOME: dangles under the pointer and looks toward the "e" hole.
  const dragCarry = (dt: number) => {
    const dx = pointer.x - pointer.downX
    const dy = pointer.y - pointer.downY
    const rawX = HOME + dx
    const rawY = GROUND + dy
    const dist = Math.hypot(rawX - HOLE.x, rawY - 5 - HOLE.y)
    if (dist < 9) return startPack()
    const magnet = clamp01((HOLE_MAGNET - dist) / HOLE_MAGNET) * 0.45
    const targetX = lerp(rawX, REST.x, magnet)
    const targetY = lerp(rawY, REST.y, magnet)
    const ease = 1 - Math.exp(-dt * 28)
    const vx = targetX - c.x
    c.x += vx * ease
    c.y += (targetY - c.y) * ease
    c.rot = clamp(vx * 3.5 + Math.sin(c.now * 22) * 5, 26)
    c.crouch = -0.12 + magnet * 0.2
    c.wide = 1.2
    c.squint = 1 - magnet * 0.3
    const hx = HOLE.x - c.x
    const hy = HOLE.y - (c.y - 5)
    const hd = Math.hypot(hx, hy) || 1
    c.lookX = (hx / hd) * Math.min(1, hd / 10)
    c.lookY = (hy / hd) * Math.min(1, hd / 10) * 0.6
    c.pinOpacity = magnet
    c.pinX = PIN_SLOT.x
    c.pinY = PIN_SLOT.y
    c.pinRot = 0
    c.pinScale = 1 + magnet * 0.25
    // Over the composer it curls up and peers down at it, and the composer sinks a little under it.
    drop.over =
      !!onPlay && !!drop.el && pointer.x > drop.l && pointer.x < drop.r && pointer.y > drop.t && pointer.y < drop.b
    c.ball += ((drop.over ? 0.85 : 0) - c.ball) * (1 - Math.exp(-dt * 14))
    if (!drop.over) return
    c.lookX = 0
    c.lookY = 0.6
    c.squint = 0.8
    c.rot *= 0.4
  }

  const play = () => {
    drop.over = false
    render()
    if (!onPlay) return
    Object.assign(c, { phase: "game", rot: 0, crouch: 0, wide: 1, squint: 1 })
    placeGrip("none")
    measure()
    onPlay(ball)
  }

  const ball: LodgerBall = {
    radius: () => 5 * rect.scale,
    at: () => ({ x: rect.px + c.x * rect.scale, y: rect.py + (c.y - 5) * rect.scale }),
    place: (x, y, pose) => {
      c.now = performance.now() / 1000
      c.x = (x - rect.px) / rect.scale
      c.y = (y - rect.py) / rect.scale + 5
      c.lookX = Math.cos(pose.lookAngle) * pose.look
      c.lookY = Math.sin(pose.lookAngle) * pose.look * 0.6
      c.stretch = pose.stretch
      c.angle = pose.angle
      c.squint = pose.squint
      c.ball = pose.curl
      render()
    },
    blink: () => blinkOnce(),
    done: () => {
      measure()
      Object.assign(c, {
        phase: "return",
        fromX: c.x,
        fromY: c.y,
        t0: performance.now() / 1000,
        stretch: 0,
        squint: 1,
        dur: 0.7,
        arc: 36,
      })
      wake()
    },
  }

  const returnHome = (t: number) => {
    const u = seg(t, 0, c.dur)
    c.x = lerp(c.fromX, HOME, easeOut(u))
    c.y = lerp(c.fromY, GROUND, u) - Math.sin(Math.PI * u) * c.arc
    c.rot = lerp(c.rot, 0, u)
    c.crouch = 0
    c.wide = 1
    c.pinOpacity = 0
    c.ball = Math.min(c.ball, 1 - easeInOut(u))
    if (t < c.dur) return
    tap(0.25)
    settleIdle()
  }

  const startPack = () => {
    c.now = performance.now() / 1000
    resetPoses(0)
    parts.flat.style.display = ""
    placeGrip("none")
    Object.assign(c, {
      phase: "pack",
      t0: c.now,
      cue: 0,
      fromX: c.x,
      fromY: c.y,
    })
    onClose()
    if (sound()) PinSound.knock(c.x, W)
    if (still) {
      onFlat()
      restHidden()
      return
    }
    wake()
  }

  const packCues = [
    {
      at: 0.95,
      run: () => {
        if (sound()) PinSound.slot(75, 78, HOLE.x, W)
      },
    },
    {
      at: 1.14,
      run: () => {
        onFlat()
        blinkOnce()
      },
    },
  ]

  // Reverse sequence: the lodger hops into the "e" hole, grabs the corner pin, and reels all 800 pins
  // from left ("o") back into the "e" before tucking itself back inside.
  const pack = (t: number) => {
    while (c.cue < packCues.length && t >= packCues[c.cue].at) packCues[c.cue++].run()
    if (t >= 1.2) return restHidden()

    poses.forEach((p, i) => {
      const start = 0.32 + (i / 7) * 0.48
      const u = seg(t, start, start + 0.32)
      p.opacity = u
      p.x = 0
      p.y = 0
    })

    // Hops from the cursor into the "e" counter and grabs the corner starter pin while any loose pins fly home.
    if (t < 0.3) {
      const u = t / 0.3
      c.x = lerp(c.fromX, REST.x, easeOut(u))
      c.y = lerp(c.fromY, REST.y - 3, easeOut(u)) - Math.sin(Math.PI * u) * 8
      c.rot = lerp(c.rot, 10, u)
      c.crouch = 0
      c.wide = 1.15
      c.squint = 1
      c.body = 1
      c.eyes = 1
      c.notch = u
      c.pinOpacity = 1
      c.pinX = lerp(PIN_SLOT.x, REST.x + 3.5, u)
      c.pinY = lerp(PIN_SLOT.y, REST.y - 10.5, u)
      c.pinRot = u * 18
      c.pinScale = 1.3
      return
    }
    // Reels the wave in from "o" -> "e" while holding the corner pin.
    if (t < 0.9) {
      const u = seg(t, 0.3, 0.9)
      const tug = Math.sin(u * Math.PI * 3)
      c.x = REST.x + tug * 1.2
      c.y = REST.y - 3 + u * 2
      c.rot = tug * 10
      c.crouch = Math.abs(tug) * 0.14
      c.wide = 1
      c.squint = 0.45
      c.lookX = -1
      c.lookY = 0
      c.notch = 1
      c.pinOpacity = 1
      c.pinX = lerp(REST.x + 3.5, PIN_SLOT.x, u)
      c.pinY = lerp(REST.y - 10.5, PIN_SLOT.y, u)
      c.pinRot = (1 - u) * 18
      c.pinScale = lerp(1.3, 1, u)
      return
    }
    // Slots the corner pin flush and sinks back into the "e" hole.
    const u = seg(t, 0.9, 1.14)
    c.x = REST.x
    c.y = lerp(REST.y - 1, REST.y, easeOut(u))
    c.rot = 0
    c.crouch = Math.sin(u * Math.PI) * 0.18
    c.wide = 1
    c.squint = 1
    c.lookX = 0
    c.lookY = 0
    c.body = 1 - easeInOut(u)
    c.notch = 1 - u
    c.pinOpacity = 1 - u
  }

  const hop = (t: number) => {
    const u = seg(t, 0.08, 0.43)
    c.crouch = t < 0.08 ? 0.15 * (t / 0.08) : 0
    c.y = GROUND - Math.sin(Math.PI * u) * 8
    c.squint = 0.35
    if (t >= 0.43 && c.cue === 0) {
      c.cue = 1
      tap(0.3)
    }
    if (t < 0.8) return
    Object.assign(c, { phase: "idle", y: GROUND, crouch: 0, squint: 1 })
    look()
    scheduleBlink()
  }

  const look = () => {
    if (!pointer.inside) {
      c.lookX = 0
      c.lookY = 0
      return
    }
    const dx = pointer.x - c.x
    const dy = pointer.y - (c.y - 6)
    const d = Math.hypot(dx, dy) || 1
    const reach = Math.min(1, d / 15)
    // Gaze snaps to 0.08 units (about 0.2 px), so far-off pointer moves that would not move the eyes skip the frame.
    c.lookX = Math.round(((dx / d) * reach) / 0.08) * 0.08
    c.lookY = Math.round(((dy / d) * reach * 0.6) / 0.08) * 0.08
  }

  const impact = (amp: number) => {
    impacts.push({ at: c.now, amp })
    while (impacts.length && c.now - impacts[0].at > 1) impacts.shift()
  }
  const land = (amp: number) => {
    impact(amp)
    if (sound()) PinSound.knock(c.x, W)
  }
  const tap = (amp: number) => {
    if (amp) impact(amp)
    if (sound()) PinSound.bounce(c.x, W, 3000)
  }
  const blinkOnce = () => {
    if (still) return
    parts.blink.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(0.1)" }, { transform: "scaleY(1)" }], {
      duration: 160,
      easing: "ease-in-out",
    })
  }
  // Blinks are only scheduled while the eyes are showing, so the hidden lodger holds no timers.
  const visible = () => c.phase === "idle" || (c.phase === "hidden" && c.eyes > 0.1)
  const scheduleBlink = () => {
    if (timers.blink || still || !visible()) return
    timers.blink = window.setTimeout(
      () => {
        timers.blink = 0
        if (!visible()) return
        blinkOnce()
        scheduleBlink()
      },
      2500 + Math.random() * 3500,
    )
  }

  const render = () => {
    const squash = impacts.reduce((sum, i) => {
      const t = c.now - i.at
      return t < 0 ? sum : sum + i.amp * Math.exp(-t * 10) * Math.cos(t * 30)
    }, 0)
    const sy = (1 - squash) * (1 - c.crouch)
    const sx = (1 + squash * 0.7) * (1 + c.crouch * 0.8)
    const attr = (el: Element, name: string) => (value: string) => el.setAttribute(name, value)
    const opacity = (el: SVGElement) => (value: string) => {
      el.style.opacity = value
    }
    // Stretching along an angle and rotating back keeps the eyes upright while the ball squashes on impact.
    const stretch = c.stretch
      ? ` rotate(${c.angle} 0 -5) scale(${1 + c.stretch} ${1 - c.stretch * 0.8}) rotate(${-c.angle} 0 -5)`
      : ""
    put(
      "critter",
      attr(parts.critter, "transform"),
      `translate(${c.x} ${c.y})${stretch} rotate(${c.rot} 0 -5) scale(${sx} ${sy})`,
    )
    put("body", opacity(parts.body), `${c.body}`)
    put(
      "curl",
      (value) => {
        const width = 12 - 2 * Number(value)
        parts.body.setAttribute("x", `${-width / 2}`)
        parts.body.setAttribute("width", `${width}`)
        parts.body.setAttribute("rx", `${1.5 + 3.5 * Number(value)}`)
      },
      `${Math.round(c.ball * 100) / 100}`,
    )
    if (drop.el)
      put("drop", (value) => drop.el?.toggleAttribute("data-lodger-over", value === "1"), drop.over ? "1" : "0")
    // Carried, returning, or in play, the lodger crosses the composer, so it is lifted above it.
    put(
      "lifted",
      (value) => parts.box.parentElement?.toggleAttribute("data-lifted", value === "1"),
      c.phase === "carry" || c.phase === "return" || c.phase === "game" ? "1" : "0",
    )
    put("eyes", opacity(parts.eyes), `${c.eyes}`)
    put(
      "look",
      attr(parts.eyes, "transform"),
      `translate(${c.lookX} ${c.lookY - 6}) scale(${c.wide} ${c.wide * c.squint}) translate(0 6)`,
    )
    put("neck", opacity(parts.neck), `${c.neck}`)
    if (c.neck) {
      const len = Math.hypot(c.x - HOLE.x, c.y - 5 - HOLE.y)
      put("neck-x1", attr(parts.neck, "x1"), `${HOLE.x}`)
      put("neck-y1", attr(parts.neck, "y1"), `${HOLE.y}`)
      put("neck-x2", attr(parts.neck, "x2"), `${c.x}`)
      put("neck-y2", attr(parts.neck, "y2"), `${c.y - 5}`)
      put("neck-w", attr(parts.neck, "stroke-width"), `${Math.max(2, Math.min(6, 40 / Math.max(1, len)))}`)
    }
    put("notch", opacity(parts.notch), `${c.notch}`)
    put("pin", opacity(parts.pin), `${c.pinOpacity}`)
    if (c.pinOpacity)
      put(
        "pin-at",
        attr(parts.pin, "transform"),
        `translate(${c.pinX} ${c.pinY}) rotate(${c.pinRot}) scale(${c.pinScale})`,
      )
    poses.forEach((p, i) => {
      const cx = LETTERS[i].cx
      const el = parts.letters[i]
      if (!el) return
      put(`letter-${i}`, (value) => (el.style.opacity = value), `${p.opacity}`)
      put(
        `letter-at-${i}`,
        attr(el, "transform"),
        `translate(${cx + p.x} ${GROUND + p.y}) scale(${p.sx} ${p.sy}) translate(${-cx} ${-GROUND})`,
      )
    })
  }

  const toUnits = (event: PointerEvent) => {
    pointer.x = (event.clientX - rect.left) / rect.scale
    pointer.y = (event.clientY - rect.top) / rect.scale
    pointer.inside = true
  }
  // Pointer moves only schedule a frame when the lodger visibly changes; far from the "e" they do nothing.
  const onMove = (event: PointerEvent) => {
    toUnits(event)
    c.near = clamp01((24 - Math.hypot(pointer.x - HOLE.x, pointer.y - HOLE.y)) / 14)
    if (c.phase !== "hidden" && c.phase !== "idle") return
    if (c.phase === "hidden") {
      const eyes = c.near * 0.55
      if (eyes === c.eyes) return
      c.eyes = eyes
    }
    const gaze = { x: c.lookX, y: c.lookY }
    look()
    if (c.phase === "idle" && gaze.x === c.lookX && gaze.y === c.lookY) return
    scheduleBlink()
    wake()
  }
  const onEnter = () => measure()
  const onLeave = () => {
    pointer.inside = false
    c.near = 0
    if (c.phase !== "hidden" && c.phase !== "idle") return
    if (c.phase === "hidden") c.eyes = 0
    look()
    wake()
  }
  const onGrab = (event: PointerEvent) => {
    if (event.button !== 0 || (c.phase !== "hidden" && c.phase !== "idle")) return
    event.preventDefault()
    event.stopPropagation()
    parts.grip.setPointerCapture(event.pointerId)
    measure()
    if (c.phase === "idle") {
      drop.el = panel.querySelector<HTMLElement>('[data-slot="new-session-composer"]') ?? undefined
      const r = drop.el?.querySelector('[data-component="composer"]')?.getBoundingClientRect()
      if (r) {
        const p = panel.getBoundingClientRect()
        drop.l = (r.left - p.left - rect.px) / rect.scale
        drop.r = (r.right - p.left - rect.px) / rect.scale
        drop.t = (r.top - p.top - rect.py) / rect.scale
        drop.b = (r.bottom - p.top - rect.py) / rect.scale
      }
    }
    toUnits(event)
    Object.assign(pointer, { downX: pointer.x, downY: pointer.y })
    c.phase = c.phase === "hidden" ? "drag" : "carry"
    wake()
  }
  const onRelease = () => {
    if (c.phase === "drag") {
      if (Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY) > POP) return pop()
      Object.assign(c, { phase: "snap", vx: 0, vy: 0 })
      if (still) restHidden()
      render()
      return
    }
    if (c.phase !== "carry") return
    const moved = Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY)
    if (moved < 4) {
      if (still) return settleIdle()
      Object.assign(c, { phase: "hop", x: HOME, y: GROUND, rot: 0, t0: performance.now() / 1000, cue: 0 })
      wake()
      return
    }
    if (drop.over && !still) return play()
    drop.over = false
    const dropX = HOME + (pointer.x - pointer.downX)
    const dropY = GROUND + (pointer.y - pointer.downY) - 5
    if (
      Math.hypot(c.x - HOLE.x, c.y - 5 - HOLE.y) < HOLE_MAGNET ||
      Math.hypot(dropX - HOLE.x, dropY - HOLE.y) < HOLE_MAGNET ||
      Math.hypot(pointer.x - HOLE.x, pointer.y - HOLE.y) < HOLE_MAGNET
    )
      return startPack()
    if (still) return settleIdle()
    Object.assign(c, { phase: "return", fromX: c.x, fromY: c.y, t0: performance.now() / 1000, dur: 0.34, arc: 10 })
    wake()
  }

  const resize = new ResizeObserver(fitStage)
  resize.observe(parts.box)
  // The panel can resize while the clamped wordmark keeps its size but moves, e.g. when the sidebar toggles.
  resize.observe(panel)
  fitStage()
  placeGrip("hidden")
  panel.addEventListener("pointermove", onMove, { passive: true })
  panel.addEventListener("pointerenter", onEnter)
  panel.addEventListener("pointerleave", onLeave)
  parts.grip.addEventListener("pointerdown", onGrab)
  parts.grip.addEventListener("pointerup", onRelease)
  parts.grip.addEventListener("pointercancel", onRelease)
  parts.grip.addEventListener("lostpointercapture", onRelease)
  render()

  return () => {
    cancelAnimationFrame(timers.raf)
    clearTimeout(timers.blink)
    resize.disconnect()
    panel.removeEventListener("pointermove", onMove)
    panel.removeEventListener("pointerenter", onEnter)
    panel.removeEventListener("pointerleave", onLeave)
    parts.grip.removeEventListener("pointerdown", onGrab)
    parts.grip.removeEventListener("pointerup", onRelease)
    parts.grip.removeEventListener("pointercancel", onRelease)
    parts.grip.removeEventListener("lostpointercapture", onRelease)
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const seg = (t: number, from: number, to: number) => clamp01((t - from) / (to - from))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

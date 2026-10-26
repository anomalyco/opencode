import { For, onCleanup, onMount } from "solid-js"
import type { PinBoardHandle } from "./pin-board"
import { PinSound } from "./pin-sound"
import type { LodgerBall } from "./wordmark"

const LIVES = 3
const ENTER = 0.85
const EXIT = 1

type Phase = "enter" | "serve" | "play" | "miss" | "exit"
type Box = { x: number; y: number; w: number; h: number; r: number }

/**
 * A brick breaker homage. The lodger curls into the ball, the pins are the bricks, and the composer shrinks
 * into the paddle. Like Arkanoid, the ball waits on the paddle until it is served with a click or Space.
 */
export function NewSessionBrickBreaker(props: {
  panel: HTMLElement
  board: PinBoardHandle
  ball: LodgerBall
  sound: () => boolean
  onDone: () => void
}) {
  let paddle!: HTMLDivElement
  let hud!: HTMLDivElement
  let score!: HTMLSpanElement
  const spares: HTMLSpanElement[] = []
  const walls: HTMLSpanElement[] = []

  onMount(() =>
    onCleanup(
      mountGame({ panel: props.panel, paddle, hud, score, spares, walls }, props.board, props.ball, props.sound, props.onDone),
    ),
  )

  return (
    <>
      <div
        ref={paddle}
        aria-hidden="true"
        data-slot="brick-breaker-paddle"
        class="pointer-events-none absolute left-0 top-0 -z-[5] origin-center"
      />
      <div
        ref={hud}
        aria-hidden="true"
        data-slot="brick-breaker-hud"
        class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
      >
        <span ref={(el) => (walls[0] = el)} class="absolute inset-y-0 left-0 w-px bg-v2-border-border-base" />
        <span ref={(el) => (walls[1] = el)} class="absolute inset-y-0 left-0 w-px bg-v2-border-border-base" />
        <span
          ref={score}
          class="absolute right-4 top-3 font-mono text-[11px] leading-[16px] tabular-nums text-v2-text-text-faint"
        />
        <div class="absolute bottom-4 left-4 flex gap-1.5">
          <For each={Array.from({ length: LIVES - 1 })}>
            {(_, i) => (
              <span
                ref={(el) => (spares[i()] = el)}
                class="h-1.5 w-5 rounded-full bg-v2-icon-icon-faint transition-[opacity,transform] duration-300"
              />
            )}
          </For>
        </div>
      </div>
    </>
  )
}

function mountGame(
  parts: {
    panel: HTMLElement
    paddle: HTMLDivElement
    hud: HTMLDivElement
    score: HTMLSpanElement
    spares: HTMLSpanElement[]
    walls: HTMLSpanElement[]
  },
  board: PinBoardHandle,
  ball: LodgerBall,
  sound: () => boolean,
  onDone: () => void,
) {
  const panel = parts.panel
  const wrap = panel.querySelector<HTMLElement>('[data-slot="new-session-composer"]')
  const form = wrap?.querySelector<HTMLElement>('[data-component="composer"]')
  const tip = panel.querySelector<HTMLElement>('[data-component="new-session-tip"]')
  const surface = form ? getComputedStyle(form).backgroundColor : ""
  // The arena is exactly as wide as the wordmark, like Arkanoid's tall, narrow playfield.
  const view = { left: 0, top: 0, w: 0, h: 0, l: 0, r: 0 }
  const g = { phase: "enter" as Phase, t0: performance.now() / 1000, last: 0, raf: 0, lives: LIVES, score: 0 }
  const rally = { combo: 0, hits: 0, base: 0, speed: 0 }
  const pad = { x: 0, target: 0, v: 0, w: 0, h: 12, y: 0, tilt: 0, kickAt: -1, steer: 1 }
  const b = { x: 0, y: 0, vx: 0, vy: 0, hitAt: -1, hitAngle: 0, hitAmp: 0, squintUntil: 0, curl: 0.85, landed: false }
  const keys = { left: false, right: false }
  const start = { ball: ball.at(), composer: composerBox(), from: composerBox() }
  // The paddle's drawn shape, so the exit morph starts from wherever the paddle is.
  const shape: Box = { ...start.composer }
  const written = { w: -1, h: -1, r: -1, transform: "", score: "" }

  const layout = () => {
    const r = panel.getBoundingClientRect()
    view.left = r.left
    view.top = r.top
    view.w = r.width
    view.h = r.height
    // Walls sit on the wordmark's outer pin edges, using the board's integer pitch and rounded origin, so the
    // ball can only reach the top by breaking through.
    const logo = panel.querySelector('[data-slot="wordmark-box"]')?.getBoundingClientRect()
    const pitch = logo ? Math.max(3, Math.round(logo.width / 78)) : 0
    const x0 = logo ? Math.round(logo.left - r.left + (logo.width - pitch * 78) / 2) : 0
    const c = composerBox()
    view.l = logo ? x0 : Math.max(0, c.x)
    view.r = logo ? x0 + pitch * 78 : Math.min(view.w, c.x + c.w)
    parts.walls[0].style.transform = `translateX(${view.l - 1}px)`
    parts.walls[1].style.transform = `translateX(${view.r}px)`
    pad.w = Math.max(84, Math.min(136, (view.r - view.l) * 0.15))
    pad.y = view.h - 64
    rally.base = Math.max(460, Math.min(760, view.h * 0.7))
    rally.speed = rally.base * (1 + Math.min(0.55, rally.hits * 0.025))
  }

  function composerBox(): Box {
    const p = panel.getBoundingClientRect()
    const r = form?.getBoundingClientRect()
    if (!r) return { x: p.width / 2 - 60, y: p.height - 64, w: 120, h: 12, r: 6 }
    const radius = form ? parseFloat(getComputedStyle(form).borderTopLeftRadius) : 12
    return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height, r: radius || 12 }
  }

  const paddleBox = (): Box => ({ x: pad.x - pad.w / 2, y: pad.y, w: pad.w, h: pad.h, r: pad.h / 2 })

  const frame = (ms: number) => {
    g.raf = 0
    const now = ms / 1000
    const dt = Math.min(1 / 30, Math.max(1 / 240, now - g.last))
    g.last = now
    const t = now - g.t0
    movePaddle(dt, now)
    if (g.phase === "enter") enter(t)
    if (g.phase === "serve") serve(t)
    if (g.phase === "play") play(dt, now)
    if (g.phase === "miss") miss(t)
    if (g.phase === "exit") return exit(t)
    pose(now)
    board.steer(b.x, b.y)
    g.raf = requestAnimationFrame(frame)
  }

  const movePaddle = (dt: number, now: number) => {
    if (g.phase === "enter" || g.phase === "exit") return
    if (keys.left !== keys.right) pad.target += (keys.right ? 1 : -1) * 1100 * dt
    pad.target = Math.max(view.l + pad.w / 2 + 4, Math.min(view.r - pad.w / 2 - 4, pad.target))
    const prev = pad.x
    pad.x += (pad.target - pad.x) * (1 - Math.exp(-dt * 30))
    pad.v = (pad.x - prev) / dt
    pad.tilt += (Math.max(-5, Math.min(5, pad.v / 260)) - pad.tilt) * (1 - Math.exp(-dt * 14))
    const k = now - pad.kickAt
    const kick = k < 0.5 ? Math.exp(-k * 12) * Math.sin(k * 34) * 4 : 0
    draw({ ...paddleBox(), y: pad.y + kick }, pad.tilt)
  }

  // The composer content fades, then its box springs down and narrows into the paddle while the ball rides on top.
  const enter = (t: number) => {
    const u = seg(t, 0.1, ENTER)
    const e = spring(u)
    const to = paddleBox()
    const box = {
      x: lerp(start.from.x + start.from.w / 2, to.x + to.w / 2, e),
      y: lerp(start.from.y, to.y, e),
      w: Math.max(pad.h, lerp(start.from.w, to.w, e)),
      h: Math.max(4, lerp(start.from.h, to.h, e)),
      r: lerp(start.from.r, to.r, Math.min(1, u * 1.6)),
    }
    draw({ ...box, x: box.x - box.w / 2 }, 0)
    const k = easeOut(seg(t, 0, 0.38))
    const r = ball.radius()
    b.x = lerp(start.ball.x, box.x, k)
    b.y = lerp(start.ball.y, box.y - r, k) - Math.sin(Math.PI * k) * 28
    b.curl = lerp(0.85, 1, k)
    if (k >= 1 && !b.landed) {
      b.landed = true
      bump(Math.PI / 2, 0.32)
      if (sound()) PinSound.paddle(b.x, view.w)
    }
    // Once it has shrunk enough to read as a paddle, it takes on the colour of the pins it is about to break.
    if (t >= 0.3) parts.paddle.style.background = "var(--v2-icon-icon-muted)"
    if (t >= 0.5) parts.hud.style.opacity = "1"
    if (t < ENTER) return
    pad.target = pad.x
    setPhase("serve")
    panel.style.cursor = "none"
  }

  // The ball waits on the paddle like Arkanoid's; after a miss it drops back onto it first.
  const serve = (t: number) => {
    const r = ball.radius()
    const drop = g.lives < LIVES ? seg(t, 0, 0.42) : 1
    b.x = pad.x
    b.y = pad.y - r - Math.pow(1 - drop, 2) * 110
    b.vx = 0
    b.vy = 0
    b.curl = 1
    if (drop >= 1 && !b.landed) {
      b.landed = true
      bump(Math.PI / 2, 0.36)
      if (sound()) PinSound.paddle(b.x, view.w)
    }
  }

  const launch = () => {
    if (g.phase !== "serve" || !b.landed) return
    // Serve away from the side the paddle is moving toward, up and to the right when still.
    const lean = Math.abs(pad.v) > 40 ? Math.sign(pad.v) : 1
    const a = lean * (0.32 + Math.random() * 0.12)
    b.vx = Math.sin(a) * rally.speed
    b.vy = -Math.cos(a) * rally.speed
    rally.combo = 0
    pad.kickAt = performance.now() / 1000
    bump(Math.PI / 2, 0.3)
    if (sound()) PinSound.paddle(b.x, view.w)
    setPhase("play")
  }

  const play = (dt: number, now: number) => {
    const r = ball.radius()
    // Substeps keep the ball from tunnelling through a pin between frames at high speed.
    const steps = Math.max(1, Math.ceil((rally.speed * dt) / (r * 0.35)))
    const sdt = dt / steps
    for (let i = 0; i < steps; i++) {
      b.x += b.vx * sdt
      b.y += b.vy * sdt
      if (b.x < view.l + r || b.x > view.r - r) {
        b.x = Math.max(view.l + r, Math.min(view.r - r, b.x))
        b.vx = b.x <= view.l + r ? Math.abs(b.vx) : -Math.abs(b.vx)
        bump(0, 0.22)
        if (sound()) PinSound.bounce(b.x, view.w, 4000)
      }
      if (b.y < r) {
        b.y = r
        b.vy = Math.abs(b.vy)
        bump(Math.PI / 2, 0.22)
        if (sound()) PinSound.bounce(b.x, view.w, 4000)
      }
      if (
        b.vy > 0 &&
        b.y + r >= pad.y &&
        b.y - r < pad.y + pad.h &&
        Math.abs(b.x - pad.x) <= pad.w / 2 + r * 0.6
      ) {
        // Classic paddle control: where the ball lands sets its angle, up to 60° from vertical.
        const off = Math.max(-1, Math.min(1, (b.x - pad.x) / (pad.w / 2)))
        const a = off * (Math.PI / 3) + Math.max(-0.15, Math.min(0.15, pad.v / 6000))
        rally.hits++
        rally.speed = rally.base * (1 + Math.min(0.55, rally.hits * 0.025))
        rally.combo = 0
        b.vx = Math.sin(a) * rally.speed
        b.vy = -Math.cos(a) * rally.speed
        b.y = pad.y - r
        pad.kickAt = now
        bump(Math.PI / 2, 0.34)
        if (sound()) PinSound.paddle(b.x, view.w)
      }
      // Each hit carves a round bite out of the wordmark rather than a single pin.
      const hit = board.collide(b.x, b.y, r, r * 0.55, b.vx, b.vy)
      if (hit) {
        const side = Math.abs(hit.nx) > Math.abs(hit.ny)
        if (side && b.vx * hit.nx < 0) b.vx = -b.vx
        if (!side && b.vy * hit.ny < 0) b.vy = -b.vy
        rally.combo++
        g.score += hit.count * 10 * Math.min(8, rally.combo)
        b.squintUntil = now + 0.14
        bump(side ? 0 : Math.PI / 2, 0.26)
        if (sound()) PinSound.brick(b.x, view.w, rally.combo)
        if (!board.left()) return finish("win")
      }
      // A nearly flat rally never comes back down, so keep at least a quarter of the speed vertical.
      const min = rally.speed * 0.25
      if (Math.abs(b.vy) < min) {
        b.vy = (b.vy < 0 ? -1 : 1) * min
        b.vx = Math.sign(b.vx || 1) * Math.sqrt(rally.speed * rally.speed - min * min)
      }
      if (b.y - r > view.h) {
        setPhase("miss")
        if (sound()) PinSound.sweep({ duration: 0.45, columns: 78, reverse: true })
        return
      }
    }
  }

  const miss = (t: number) => {
    if (t < 0.55) return
    g.lives--
    parts.spares.forEach((el, i) => {
      el.style.opacity = i < g.lives - 1 ? "1" : "0"
      el.style.transform = i < g.lives - 1 ? "" : "translateY(4px)"
    })
    if (!g.lives) return finish("lose")
    b.landed = false
    setPhase("serve")
  }

  const finish = (kind: "win" | "lose" | "quit") => {
    if (g.phase === "exit") return
    start.composer = composerBox()
    start.from = { ...shape }
    setPhase("exit")
    panel.style.cursor = ""
    parts.hud.style.opacity = "0"
    parts.paddle.style.background = surface
    board.restore()
    ball.done()
    if (sound()) PinSound.sweep({ duration: 0.9, columns: 78, reverse: kind !== "win" })
  }

  // The paddle grows back into the composer, then the composer content fades in over it.
  const exit = (t: number) => {
    const e = easeInOut(seg(t, 0.15, 0.75))
    const to = start.composer
    draw(
      {
        x: lerp(start.from.x, to.x, e),
        y: lerp(start.from.y, to.y, e),
        w: lerp(start.from.w, to.w, e),
        h: lerp(start.from.h, to.h, e),
        r: lerp(start.from.r, to.r, e),
      },
      pad.tilt * (1 - e),
    )
    if (t >= 0.75) {
      if (wrap) wrap.style.opacity = ""
      if (tip) tip.style.opacity = ""
      parts.paddle.style.opacity = "0"
    }
    if (t < EXIT) {
      g.raf = requestAnimationFrame(frame)
      return
    }
    onDone()
  }

  const setPhase = (phase: Phase) => {
    g.phase = phase
    g.t0 = performance.now() / 1000
  }

  const bump = (angle: number, amp: number) => {
    b.hitAt = performance.now() / 1000
    b.hitAngle = angle
    b.hitAmp = amp
  }

  const pose = (now: number) => {
    const t = now - b.hitAt
    const jiggle = t < 0.45 ? b.hitAmp * Math.exp(-t * 12) * Math.cos(t * 38) : 0
    const moving = g.phase === "play" || g.phase === "miss"
    const heading = Math.atan2(b.vy, b.vx)
    const squash = Math.abs(jiggle) > 0.015
    ball.place(b.x, b.y, {
      look: moving ? 1 : 0.8,
      lookAngle: moving ? heading : -Math.PI / 2,
      stretch: squash ? -jiggle : moving ? 0.07 : 0,
      angle: ((squash ? b.hitAngle : heading) * 180) / Math.PI,
      squint: now < b.squintUntil ? 0.45 : 1,
      curl: b.curl,
    })
    const text = `${g.score}`.padStart(5, "0")
    if (text !== written.score) {
      written.score = text
      parts.score.textContent = text
    }
  }

  const draw = (box: Box, tilt: number) => {
    Object.assign(shape, box)
    const el = parts.paddle
    const w = Math.round(box.w * 10) / 10
    const h = Math.round(box.h * 10) / 10
    if (w !== written.w) el.style.width = `${(written.w = w)}px`
    if (h !== written.h) el.style.height = `${(written.h = h)}px`
    if (box.r !== written.r) el.style.borderRadius = `${(written.r = box.r)}px`
    const transform = `translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg)`
    if (transform !== written.transform) el.style.transform = written.transform = transform
  }

  const onMove = (event: PointerEvent) => {
    pad.target = event.clientX - view.left
  }
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || g.phase === "exit") return
    event.preventDefault()
    event.stopPropagation()
    launch()
  }
  const onKey = (event: KeyboardEvent) => {
    if (g.phase === "exit") return
    const down = event.type === "keydown"
    if (event.key === "Escape" && down) finish("quit")
    else if (event.key === "ArrowLeft" || event.key === "a") keys.left = down
    else if (event.key === "ArrowRight" || event.key === "d") keys.right = down
    else if ((event.key === " " || event.key === "ArrowUp") && down) launch()
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  const onBlur = () => {
    keys.left = false
    keys.right = false
  }

  layout()
  pad.x = start.composer.x + start.composer.w / 2
  pad.target = pad.x
  b.x = start.ball.x
  b.y = start.ball.y
  parts.paddle.style.background = surface
  parts.paddle.style.boxShadow = "var(--v2-elevation-raised)"
  parts.paddle.style.transition = "opacity 180ms ease-out, background-color 360ms ease-out"
  // The provider tip sits where the paddle plays, so it steps aside for the game.
  if (tip) {
    tip.style.transition = "opacity 200ms ease-out"
    tip.style.opacity = "0"
  }
  draw(start.composer, 0)
  if (wrap) {
    if (wrap.contains(document.activeElement) && document.activeElement instanceof HTMLElement)
      document.activeElement.blur()
    wrap.style.transition = "opacity 160ms ease-out"
    wrap.style.opacity = "0"
    wrap.style.pointerEvents = "none"
    wrap.inert = true
  }
  board.play()
  const resize = new ResizeObserver(layout)
  resize.observe(panel)
  panel.addEventListener("pointermove", onMove, { passive: true })
  panel.addEventListener("pointerdown", onDown, { capture: true })
  window.addEventListener("keydown", onKey, { capture: true })
  window.addEventListener("keyup", onKey, { capture: true })
  window.addEventListener("blur", onBlur)
  g.last = performance.now() / 1000 - 1 / 60
  g.raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(g.raf)
    resize.disconnect()
    panel.removeEventListener("pointermove", onMove)
    panel.removeEventListener("pointerdown", onDown, { capture: true })
    window.removeEventListener("keydown", onKey, { capture: true })
    window.removeEventListener("keyup", onKey, { capture: true })
    window.removeEventListener("blur", onBlur)
    panel.style.cursor = ""
    if (tip) {
      tip.style.opacity = ""
      tip.style.transition = ""
    }
    if (!wrap) return
    wrap.style.opacity = ""
    wrap.style.transition = ""
    wrap.style.pointerEvents = ""
    wrap.inert = false
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const seg = (t: number, from: number, to: number) => Math.max(0, Math.min(1, (t - from) / (to - from)))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
// An underdamped spring that settles by t = 1, overshooting about 9% on the way.
const spring = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(9 * t))

import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { fontContent, isLetter, modules } from "~/lib/font-content"
import { Word } from "./glyph"
import { Plate, prefersReducedMotion } from "./plate"

const WORD = "opencode"
const WORD_UNITS = WORD.length * 30 - 6
const ZOOM = 5
// Each 6-unit module is drawn as 12 × 12 micro-squares.
const MICRO = 0.5
const HOLD_MS = 280

/**
 * Plate: a large white "opencode" on a dark field. Hovering (or pressing and holding on touch)
 * shows a round blue loupe that reveals each module as a grid of 144 white micro-squares,
 * with a faint reticle and a readout in font units. The loupe trails the pointer with a lerp.
 */
export function Loupe() {
  let stage!: HTMLDivElement
  let word!: HTMLDivElement
  let lens!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  const [shown, setShown] = createSignal(false)
  const [readout, setReadout] = createSignal("")

  onMount(() => {
    const context = canvas.getContext("2d")!
    const reduced = prefersReducedMotion()
    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    let frame = 0
    let active = false
    let lift = 0
    let blue = "#3b5cf6"

    const render = () => {
      const size = lens.clientWidth
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr)
        canvas.height = Math.round(size * dpr)
      }
      const svg = word.querySelector("svg")!.getBoundingClientRect()
      const box = stage.getBoundingClientRect()
      const perUnit = svg.width / WORD_UNITS
      const scale = perUnit * ZOOM * dpr
      // The point under the loupe's centre, in the word's own units.
      const ux = (current.x + box.left - svg.left) / perUnit
      const uy = (current.y + box.top - svg.top) / perUnit
      const half = canvas.width / 2 / scale
      const gap = Math.max(1, Math.round(dpr))

      // Inside the loupe the page is solid blue and everything on it is white: solid modules
      // opaque, the shade translucent, the micro-grid faint.
      context.fillStyle = blue
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = "#ffffff"
      for (let my = Math.floor((uy - half) / MICRO); my <= Math.ceil((uy + half) / MICRO); my++) {
        for (let mx = Math.floor((ux - half) / MICRO); mx <= Math.ceil((ux + half) / MICRO); mx++) {
          const cx = mx * MICRO
          const cy = my * MICRO
          const px = Math.round((cx - ux) * scale + canvas.width / 2)
          const py = Math.round((cy - uy) * scale + canvas.height / 2)
          const side = Math.round(MICRO * scale) - gap
          const tone = sample(cx + MICRO / 2, cy + MICRO / 2)
          context.globalAlpha = tone === "#" ? 1 : tone === "+" ? 0.35 : 0.1
          context.fillRect(px, py, side, side)
        }
      }
      context.globalAlpha = 1

      const letter = Math.floor(ux / 30)
      const within = ux - letter * 30
      setReadout(
        letter >= 0 && letter < WORD.length && within <= 24
          ? `×${ZOOM} · ${WORD[letter]} · x ${Math.round(60 + within * 20)} y ${Math.round((36 - uy) * 20)}u`
          : `×${ZOOM} · gap`,
      )
      lens.style.transform = `translate(${Math.round(current.x - size / 2)}px, ${Math.round(current.y - size / 2 - lift)}px)`
    }

    const sample = (x: number, y: number) => {
      if (y < 0 || y >= 42) return "."
      const index = Math.floor(x / 30)
      const within = x - index * 30
      const letter = WORD[index]
      if (index < 0 || !letter || !isLetter(letter) || within >= 24) return "."
      return modules[letter][Math.floor(y / 6)][Math.floor(within / 6)]
    }

    const loop = () => {
      frame = 0
      const ease = reduced ? 1 : 0.22
      current.x += (target.x - current.x) * ease
      current.y += (target.y - current.y) * ease
      render()
      if (active && (Math.abs(target.x - current.x) > 0.3 || Math.abs(target.y - current.y) > 0.3))
        frame = requestAnimationFrame(loop)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(loop)
    }

    const show = (x: number, y: number, touch: boolean) => {
      blue = getComputedStyle(lens).borderTopColor
      target.x = x
      target.y = y
      if (!active) {
        current.x = x
        current.y = y
      }
      // On touch the loupe floats above the finger, so the finger never covers it.
      lift = touch ? lens.clientWidth / 2 + 32 : 0
      active = true
      setShown(true)
      schedule()
    }
    const hide = () => {
      active = false
      setShown(false)
    }
    const local = (clientX: number, clientY: number) => {
      const box = stage.getBoundingClientRect()
      return [clientX - box.left, clientY - box.top] as const
    }

    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return
      const [x, y] = local(event.clientX, event.clientY)
      show(x, y, false)
    }
    stage.addEventListener("pointermove", pointerMove)
    stage.addEventListener("pointerleave", (event) => event.pointerType === "mouse" && hide())

    // Touch: press and hold to look; while the loupe is up, moving the finger moves it instead of scrolling.
    let hold: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number } | undefined
    const touchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      start = { x: touch.clientX, y: touch.clientY }
      hold = setTimeout(() => {
        const [x, y] = local(start!.x, start!.y)
        show(x, y, true)
      }, HOLD_MS)
    }
    const touchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (active) {
        event.preventDefault()
        const [x, y] = local(touch.clientX, touch.clientY)
        show(x, y, true)
        return
      }
      if (start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) clearTimeout(hold)
    }
    const touchEnd = () => {
      clearTimeout(hold)
      start = undefined
      hide()
    }
    stage.addEventListener("touchstart", touchStart, { passive: true })
    stage.addEventListener("touchmove", touchMove, { passive: false })
    stage.addEventListener("touchend", touchEnd)
    stage.addEventListener("touchcancel", touchEnd)
    stage.addEventListener("contextmenu", (event) => active && event.preventDefault())

    onCleanup(() => {
      cancelAnimationFrame(frame)
      clearTimeout(hold)
    })
  })

  return (
    <Plate id="loupe" tone="night" lead={fontContent.loupe.lead} aside={`×${ZOOM} · 12 × 12 per module`}>
      <div data-slot="loupe-stage" ref={stage}>
        <div data-slot="loupe-word" data-fill ref={word} style={{ "--cols": WORD_UNITS / 6 }}>
          <Word text={WORD} label={fontContent.loupe.label} />
        </div>
        <div data-slot="loupe-lens" ref={lens} aria-hidden="true" data-shown={shown() ? "" : undefined}>
          <canvas ref={canvas} />
          <span data-slot="reticle" />
          <Show when={readout()}>
            <span data-slot="loupe-readout" data-anno>
              {readout()}
            </span>
          </Show>
        </div>
        <p data-slot="loupe-hint" data-anno>
          Hover · press and hold on touch
        </p>
      </div>
    </Plate>
  )
}

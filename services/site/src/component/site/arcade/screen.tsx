import { useI18n } from "~/context/i18n"
import "./crt.css"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { siteSettings } from "../settings"
import { bootDuration, bootFrame } from "./boot"
import { GameFrame } from "./game-frame"
import { games, type Game } from "./games"
import { glass, glassClip } from "./geometry"
import { coinValues } from "./coin-tuning"
import { loadPixelLogo, PixelLogo, pixelLogo } from "./pixel-logo"
import { PixelText } from "./pixel-text"
import { play } from "./sound"

export type ScreenState = "404" | "glitch" | "boot" | "start" | "select" | "play" | "mobile"

/** What the screen says on a phone, where the games do not run (Design mode › Arcade phone message). */
export const mobileCopy = {
  "not available": { title: "Not available", lines: ["On mobile", "Visit on desktop to play"] },
  "game over": { title: "Game over", lines: ["No games on mobile", "Visit on desktop to play"] },
}

/**
 * Everything the CRT shows, drawn in code and clipped to the glass traced from the cabinet plate,
 * so effects never touch the bezel. It is laid out at `layout` px per world unit (the play zoom),
 * and the arcade scales it with the camera, so the game frame is 1:1 when playing.
 */
export function ArcadeScreen(props: {
  state: ScreenState
  layout: number
  reduced: boolean
  /** How long the boot runs, in ms (Settings › Boot). */
  bootDuration?: number
  game?: Game
  gpu?: boolean
  touch: boolean
  onBooted: () => void
  onStart: () => void
  onSelect: (game: Game) => void
  onFrame: (frame: HTMLIFrameElement | undefined) => void
  ref: (element: HTMLDivElement) => void
}) {
  const i18n = useI18n()
  const [active, setActive] = createSignal(0)
  // Small GPUs keep only the cheap parts of the CRT look (crt.css).
  const [lite, setLite] = createSignal(false)
  onMount(() => {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    setLite((memory !== undefined && memory <= 4) || navigator.hardwareConcurrency <= 4)
  })
  const tiles: HTMLButtonElement[] = []
  let startButton: HTMLButtonElement | undefined

  createEffect(
    on(
      () => props.state,
      (state) => {
        // Focus follows the screen, so the keyboard path continues without a click.
        if (state === "start") requestAnimationFrame(() => startButton?.focus({ preventScroll: true }))
        if (state === "select") requestAnimationFrame(() => tiles[active()]?.focus({ preventScroll: true }))
      },
    ),
  )

  const move = (step: number) => {
    const next = (active() + step + games.length) % games.length
    setActive(next)
    tiles[next]?.focus({ preventScroll: true })
    play("menu-move")
  }

  return (
    <div
      ref={props.ref}
      data-component="arcade-screen"
      data-state={props.state}
      data-crt={siteSettings.arcadeCrt}
      data-crt-lite={lite() ? "" : undefined}
      data-design={props.state === "mobile" ? "arcadeCrt arcadeMobileCopy" : "arcadeCrt"}
      style={{
        width: `${glass.w * props.layout}px`,
        height: `${glass.h * props.layout}px`,
        "clip-path": glassClip,
      }}
    >
      <div data-slot="glass" />

      <Show when={props.state === "404" || props.state === "glitch"}>
        <div data-slot="boot-404" aria-hidden="true">
          <PixelText text="404" class="arcade-big" />
          <span data-slot="prompt">
            <PixelText text="Insert coin" class="arcade-label" />
          </span>
        </div>
      </Show>

      <Show when={props.state === "boot"}>
        <Boot reduced={props.reduced} duration={props.bootDuration ?? bootDuration} onDone={props.onBooted} />
      </Show>

      <Show when={props.state === "start"}>
        <button
          ref={startButton}
          type="button"
          data-slot="start"
          aria-label={i18n.t("site.arcade.pressStartLabel")}
          style={{
            "--logo-reveal": `${coinValues.title.reveal}ms`,
            "--logo-cells": pixelLogo?.width ?? 64,
            "--arcade-delay": `${coinValues.title.arcade}ms`,
          }}
          onClick={() => {
            play("menu-select")
            props.onStart()
          }}
        >
          {/* The wordmark draws in (Settings › 404 arcade › Title › Logo reveal: cell by cell, or a
              left-to-right column wipe), then ARCADE snaps on and PRESS START starts blinking
              (arcade.css; timings in Settings › Coin › Title). */}
          <span data-slot="marquee">
            <span data-slot="logo-reveal" data-reveal={props.reduced ? "none" : siteSettings.arcadeLogoReveal}>
              <PixelLogo class="arcade-logo" />
              <Show when={!props.reduced && siteSettings.arcadeLogoReveal === "pixels"}>
                <LogoPixels duration={coinValues.title.reveal} order={coinValues.title.order} />
              </Show>
              <span data-slot="write-head" aria-hidden="true" />
            </span>
            <PixelText text="Arcade" class="arcade-subtitle" />
          </span>
          <PixelText text="Press start" class="arcade-press arcade-blink" />
        </button>
      </Show>

      <Show when={props.state === "select"}>
        <div
          data-slot="menu"
          role="group"
          aria-label={i18n.t("site.arcade.selectGameLabel")}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault()
              move(1)
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault()
              move(-1)
            }
          }}
        >
          <PixelText text="Select game" class="arcade-title" />
          <div data-slot="tiles" style={{ "--index": active() }}>
            {/* One set of corner brackets for the whole row: it slides to the selected cover. */}
            <span data-slot="brackets" aria-hidden="true" />
            <For each={games}>
              {(game, index) => (
                <button
                  ref={(element) => (tiles[index()] = element)}
                  type="button"
                  data-slot="tile"
                  data-active={active() === index() ? "" : undefined}
                  tabIndex={active() === index() ? 0 : -1}
                  aria-label={`Play ${game.name}, ${game.genre.toLowerCase()}`}
                  onFocus={() => setActive(index())}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "mouse" || active() === index()) return
                    setActive(index())
                    play("menu-move")
                  }}
                  onClick={() => {
                    play("menu-select")
                    props.onSelect(game)
                  }}
                >
                  <span data-slot="cover">
                    <img src={game.cover} alt="" loading="lazy" decoding="async" />
                  </span>
                  <PixelText text={game.name} class="arcade-label" />
                </button>
              )}
            </For>
          </div>
          <PixelText text="< > choose  enter play" class="arcade-hint" />
        </div>
      </Show>

      <Show when={props.state === "mobile"}>
        <div data-slot="mobile" aria-hidden="true">
          <PixelText text={mobileCopy[siteSettings.arcadeMobileCopy].title} class="arcade-title" />
          <PixelText text={mobileCopy[siteSettings.arcadeMobileCopy].lines[0]} class="arcade-label" />
          <PixelText text={mobileCopy[siteSettings.arcadeMobileCopy].lines[1]} class="arcade-hint arcade-blink" />
        </div>
      </Show>

      <Show when={props.state === "play" && props.game}>
        {(game) => <GameFrame game={game()} gpu={props.gpu} touch={props.touch} onFrame={props.onFrame} />}
      </Show>

      <div data-slot="scanlines" aria-hidden="true" />
      <div data-slot="mask" aria-hidden="true" />
      <div data-slot="roll" aria-hidden="true" />
      <div data-slot="flicker" aria-hidden="true" />
      <div data-slot="curve" aria-hidden="true" />
      {/* The bezel lip's shadow on the glass edge, and the ?debug=screen outline: the painted opening
          (arcade.tsx sets the path for the shot it is in). */}
      <svg data-slot="lip" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path data-slot="lip-shadow" d="" vector-effect="non-scaling-stroke" />
        <path data-slot="lip-debug" d="" vector-effect="non-scaling-stroke" />
      </svg>
      <div data-slot="sheen" aria-hidden="true" />
      <div data-slot="power" aria-hidden="true" />
    </div>
  )
}

/**
 * The wordmark's cell-by-cell reveal, like the site's pixel reveals: each lit cell of the 64-cell
 * logo pops on as a small square that grows to the full cell in 90 ms, in a noise order with a soft
 * left-to-right bias (`order` 0 is pure noise, 1 a clean sweep). One canvas over the logo (cheaper
 * than hundreds of animated cells), drawn for `duration` ms, then the logo's own SVG takes over. The
 * order is seeded per cell, so it is the same each time.
 */
function LogoPixels(props: { duration: number; order: number }) {
  let canvas: HTMLCanvasElement | undefined
  let frame = 0
  let disposed = false
  let shown: SVGSVGElement | undefined
  onCleanup(() => {
    disposed = true
    cancelAnimationFrame(frame)
    if (shown) shown.style.visibility = ""
  })
  // The logo is rasterised once, on first use; its svg mounts a frame after that.
  onMount(() => void loadPixelLogo().then(() => (frame = requestAnimationFrame(start))))
  const start = () => {
    const logo = pixelLogo
    const target = canvas
    const svg = target?.parentElement?.querySelector<SVGSVGElement>("svg")
    if (disposed || !logo || !target || !svg) return
    shown = svg
    const pop = 90
    const ratio = Math.min(2, devicePixelRatio || 1)
    const box = svg.getBoundingClientRect()
    // The svg's own layout size (the screen is transformed; offset sizes are untransformed).
    const width = svg.clientWidth || box.width
    const height = (width * logo.height) / logo.width
    target.width = Math.round(width * ratio)
    target.height = Math.round(height * ratio)
    const cell = target.width / logo.width
    const colour = getComputedStyle(svg).color
    const span = Math.max(1, props.duration - pop)
    const cells = logo.cells.map(([x, y]) => {
      const noise = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
      const at = (x / logo.width) * props.order + noise * (1 - props.order)
      return { x, y, start: at * span }
    })
    const context = target.getContext("2d")
    if (!context) return
    svg.style.visibility = "hidden"
    const begin = performance.now()
    const draw = (now: number) => {
      const time = now - begin
      context.clearRect(0, 0, target.width, target.height)
      context.fillStyle = colour
      for (const item of cells) {
        const t = (time - item.start) / pop
        if (t <= 0) continue
        const eased = t >= 1 ? 1 : 1 - (1 - t) * (1 - t)
        const size = cell * (0.35 + 0.65 * eased)
        const inset = (cell - size) / 2
        context.fillRect(item.x * cell + inset, item.y * cell + inset, Math.ceil(size), Math.ceil(size))
      }
      if (time < props.duration) {
        frame = requestAnimationFrame(draw)
        return
      }
      svg.style.visibility = ""
      target.style.display = "none"
    }
    frame = requestAnimationFrame(draw)
  }
  return <canvas ref={canvas} data-slot="logo-pixels" data-component="pixel-text" aria-hidden="true" />
}

/** The boot log (boot.ts), typed out in real time; reduced motion shows it complete for the same time. */
function Boot(props: { reduced: boolean; duration: number; onDone: () => void }) {
  const duration = props.duration
  const [time, setTime] = createSignal(props.reduced ? duration : 0)
  onMount(() => {
    play("boot")
    const start = performance.now()
    let request = 0
    const tick = () => {
      if (!props.reduced) setTime(performance.now() - start)
      if (performance.now() - start < duration) request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    const done = setTimeout(props.onDone, duration)
    onCleanup(() => {
      cancelAnimationFrame(request)
      clearTimeout(done)
    })
  })
  const frame = () => bootFrame(time(), duration)
  return (
    <div data-slot="boot" aria-hidden="true">
      <For each={frame().lines}>
        {(line) => (
          <div data-slot="line">
            <Show when={line.text}>
              <PixelText text={line.text} />
            </Show>
            <Show when={line.status}>
              <span data-slot="ok">
                <PixelText text={line.status ?? ""} />
              </span>
            </Show>
            <Show when={line.caret && !props.reduced}>
              <span data-slot="caret">
                <PixelText text="_" />
              </span>
            </Show>
          </div>
        )}
      </For>
      <Show when={frame().progress !== undefined}>
        <div data-slot="line">
          <PixelText text="Booting [" />
          <span data-slot="bar" style={{ "--progress": frame().progress ?? 0 }} />
          <PixelText text={`] ${Math.round((frame().progress ?? 0) * 100)}%`} />
        </div>
      </Show>
      <Show when={frame().ready}>
        <div data-slot="line">
          <PixelText text="Ready." />
        </div>
      </Show>
    </div>
  )
}

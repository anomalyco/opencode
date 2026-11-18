import "../arcade/arcade.css"
import "./arcade3d.css"
import { createEffect, createSignal, lazy, onCleanup, onMount, Show } from "solid-js"
import { Arcade404 } from "../arcade/arcade"
import { ArcadeChrome } from "../arcade/chrome"
import { escapeAction, powerDownDuration } from "../arcade/flow"
import { sendKey, type Game } from "../arcade/games"
import { glass } from "../arcade/geometry"
import { isPhone } from "../arcade/phone"
import { ArcadePanel } from "../arcade/panel"
import { ArcadeScreen, type ScreenState } from "../arcade/screen"
import { duckAmbience, play, startAudio, unlockAudio } from "../arcade/sound"
import type { Quality, Rect, Stage } from "./stage"
import { followTuning, setFps } from "./tuning"

// The Settings panel's 3D rows load with the panel (development only, like Settings).
const Arcade3DSettings = import.meta.env.DEV ? lazy(() => import("./settings-rows")) : () => undefined
// The three.js stage is browser-only: undefined in the server build, so three.js never enters the
// Worker's bundle (test/server-bundle.test.ts).
const loadStage = import.meta.env.SSR ? undefined : () => import("./stage")

/**
 * The 404 page's arcade in three.js: the same story as the image version (arcade/arcade.tsx), told
 * with a modelled cabinet in a projected photograph of the room. It falls back to the image version
 * without WebGL2, or when the GPU cannot keep up even at the lite tier.
 */
export function Arcade3D() {
  const [fallback, setFallback] = createSignal(false)
  return (
    <Show when={!fallback()} fallback={<Arcade404 />}>
      <ArcadeScene onFallback={() => setFallback(true)} />
    </Show>
  )
}

type Phase = "floor" | "drag" | "inserting" | "climb" | "select" | "play"

// The first paint is a still rendered from this very scene at its default framing (stage.ts
// capture()), so the hand-over to the live scene is invisible. Never the painted cabinet.
const posterSizes = [960, 1600, 2752]
const posterSet = (type: string) => posterSizes.map((width) => `/arcade3d/poster-${width}.${type} ${width}w`).join(", ")

function ArcadeScene(props: { onFallback: () => void }) {
  followTuning()
  const [phase, setPhase] = createSignal<Phase>("floor")
  const [screenState, setScreenState] = createSignal<Exclude<ScreenState, "mobile">>("404")
  const [game, setGame] = createSignal<Game>()
  const [gpu, setGpu] = createSignal<boolean>()
  const [frame, setFrame] = createSignal<HTMLIFrameElement>()
  const [reduced, setReduced] = createSignal(false)
  const [touch, setTouch] = createSignal(false)
  const [layout, setLayout] = createSignal(0.8)
  const [ready, setReady] = createSignal(false)
  const [grabbable, setGrabbable] = createSignal(false)
  const [announce, setAnnounce] = createSignal("")

  let root: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let screenElement: HTMLDivElement | undefined
  let stage: Stage | undefined
  let quality: Quality = "high"
  let dragging = false
  const timers: ReturnType<typeof setTimeout>[] = []
  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms))

  const go = (view: Parameters<Stage["go"]>[0], rate?: number) => stage?.go(view, rate)

  // The CRT: the canvas drawing in the 3D scene up to the boot; the real DOM screen (buttons, the
  // game frame) on the glass from the start screen on.
  createEffect(() => {
    const state = screenState()
    const levels: Record<Exclude<ScreenState, "mobile">, number> = {
      "404": 0.85,
      glitch: 0.8,
      boot: 0.6,
      start: 0.8,
      select: 0.9,
      play: 0.7,
    }
    stage?.setScreen(state, levels[state])
    // From the start screen on, the DOM screen sits on the glass for its buttons and focus; the CRT
    // shader draws the picture underneath, so the DOM stays invisible until a game is live.
    stage?.setOverlay(state === "start" || state === "select" || state === "play")
    if (screenElement) screenElement.style.opacity = state === "play" ? "1" : "0"
    if (state === "boot") stage?.powerUp()
  })

  const measure = () => {
    if (!root) return
    const width = root.clientWidth
    const height = root.clientHeight
    const portrait = height > width * 1.1
    // Playing on a touch screen: the game on top, the control panel below.
    const area: Rect =
      touch() && portrait
        ? { x: 8, y: 56, w: width - 16, h: height * 0.5 - 64 }
        : { x: 16, y: 64, w: width - 32, h: height - 96 }
    setLayout(Math.min(area.w / glass.w, area.h / glass.h))
    stage?.resize(width, height, area)
  }

  const point = (event: PointerEvent) => {
    const box = root?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  const down = (event: PointerEvent) => {
    if (!stage || (phase() !== "floor" && phase() !== "drag")) return
    const at = point(event)
    unlockAudio()
    if (!stage.grab(at.x, at.y)) return
    event.preventDefault()
    dragging = true
    root?.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent) => {
    if (!stage || !root) return
    const at = point(event)
    if (dragging) return stage.move(at.x, at.y)
    if (event.pointerType === "mouse") {
      setGrabbable(phase() === "floor" && stage.hitCoin(at.x, at.y))
    }
  }

  const up = (event: PointerEvent) => {
    if (!stage || !dragging) return
    dragging = false
    const at = point(event)
    stage.release(at.x, at.y)
    if (stage.coinState !== "anim") setPhase("floor")
  }

  const insertCoin = () => {
    if (!stage || phase() !== "floor") return
    unlockAudio()
    setPhase("inserting")
    stage.autoInsert()
  }

  // The credit wakes the machine: the camera climbs to the screen, the 404 tears and switches off,
  // the cabinet boots (it cannot be skipped), and the start screen hands over to the game menu.
  const credit = () => {
    play("coin-insert")
    play("power-up", 0.3)
    navigator.vibrate?.([14, 50, 22])
    setAnnounce("Credit 1. The machine is starting.")
    setPhase("climb")
    const start = performance.now()
    const lamp = () => {
      const t = Math.min(1, (performance.now() - start) / 900)
      // The lamps strike: a flicker, then steady.
      stage?.setPower(t < 1 ? t * (0.6 + 0.4 * Math.abs(Math.sin(t * 40))) : 1)
      if (t < 1) requestAnimationFrame(lamp)
    }
    later(reduced() ? 0 : 250, () => requestAnimationFrame(lamp))
    if (reduced()) {
      go("play")
      later(300, () => setScreenState("boot"))
      return
    }
    later(300, () => go("climb", 2.2))
    later(1000, () => go("play", 2.6))
    later(2000, () => {
      setScreenState("glitch")
      play("glitch")
    })
    later(2900, () => setScreenState("boot"))
  }

  const booted = () => {
    setScreenState("start")
    setPhase("select")
    play("start")
    setAnnounce("Press start.")
    later(3200, () => screenState() === "start" && startMenu())
  }

  const startMenu = () => {
    if (screenState() !== "start") return
    setScreenState("select")
    setAnnounce("Select a game: Blackout, Getaway or Carrier.")
  }

  const choose = async (next: Game) => {
    duckAmbience(true)
    setGame(next)
    setPhase("play")
    setScreenState("play")
    go("play", 3)
    const gpu = navigator.gpu as GPU | undefined
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    setGpu(!!adapter)
  }

  const exit = () => {
    if (phase() !== "play") return
    duckAmbience(false)
    setGpu(undefined)
    setGame(undefined)
    setFrame(undefined)
    setScreenState("select")
    setPhase("select")
    go("play", 3)
  }

  // Escape (or Back) from the powered-up machine: the CRT collapses, the camera pulls back to the
  // room, the lamps go out and the token is back on the floor, glistening.
  const powerDown = () => {
    if (escapeAction(phase()) !== "power-down") return
    for (const timer of timers.splice(0)) clearTimeout(timer)
    stage?.powerDown()
    setAnnounce("The machine powers down.")
    later(reduced() ? 0 : powerDownDuration, () => {
      setScreenState("404")
      setPhase("floor")
      stage?.setPower(0)
      stage?.reset()
      stage?.powerUp()
    })
  }

  onMount(() => {
    const meter = setInterval(() => stage && setFps(stage.fps), 500)
    onCleanup(() => clearInterval(meter))
    const stopAudio = startAudio()
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(motion.matches)
    setTouch(matchMedia("(pointer: coarse)").matches)
    const observer = new ResizeObserver(measure)
    if (root) observer.observe(root)
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const action = escapeAction(phase())
        if (action) event.preventDefault()
        if (action === "exit-game") exit()
        if (action === "power-down") powerDown()
      }
      if ((event.key === "Enter" || event.key === " ") && screenState() === "start" && !event.defaultPrevented) {
        event.preventDefault()
        play("menu-select")
        startMenu()
      }
    }
    document.addEventListener("keydown", keys)
    onCleanup(() => {
      observer.disconnect()
      document.removeEventListener("keydown", keys)
      stopAudio()
      stage?.dispose()
      for (const timer of timers) clearTimeout(timer)
    })

    if (!document.createElement("canvas").getContext("webgl2")) return props.onFallback()
    // Phones and small GPUs start on the lite tier: fewer particles, no shadows, a lower resolution.
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    quality = touch() || (memory !== undefined && memory <= 4) || navigator.hardwareConcurrency <= 4 ? "lite" : "high"
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200))
    // three.js loads after first paint; the photograph of the room holds the page until it is ready.
    idle(async () => {
      // Phones never load three.js (not-found-page.tsx swaps in the still).
      if (isPhone() || !loadStage) return
      const { createStage } = await loadStage()
      if (!canvas || !screenElement) return
      const created = await createStage({
        canvas,
        screen: screenElement,
        quality,
        reduced: reduced(),
        events: {
          ready: () => setReady(true),
          pickup: () => {
            setPhase("drag")
            play("coin-pickup")
            navigator.vibrate?.(6)
          },
          approach: () => setAnnounce("Over the coin door. Let go on the slot."),
          slide: () => {},
          insert: credit,
          land: () => {},
          slow: () => {
            if (quality === "lite") return props.onFallback()
            quality = "lite"
            stage?.setQuality("lite")
          },
        },
      })
      // The page may have gone while the scene loaded.
      if (!canvas.isConnected) return created.dispose()
      stage = created
      if (import.meta.env.DEV) Object.assign(window, { arcade3d: created })
      measure()
      created.setScreen(screenState(), 0.85)
    })
  })

  // In development the game is same-origin (the proxy), so Escape inside it can also leave the game.
  const watchFrame = (element: HTMLIFrameElement | undefined) => {
    setFrame(element)
    element?.addEventListener("load", () => {
      const win = (() => {
        try {
          return element.contentWindow?.document ? element.contentWindow : undefined
        } catch {
          return undefined
        }
      })()
      win?.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape" || !event.isTrusted) return
          event.preventDefault()
          event.stopImmediatePropagation()
          exit()
        },
        true,
      )
    })
  }

  return (
    <div
      ref={root}
      data-component="arcade-404"
      data-variant="3d"
      data-live
      data-ready={ready() ? "" : undefined}
      data-phase={phase()}
      data-grab={grabbable() ? "" : undefined}
      data-reduced={reduced() ? "" : undefined}
      data-touch={touch() ? "" : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <picture>
        <source type="image/avif" srcset={posterSet("avif")} sizes="max(100vw, 179.2vh)" />
        <img
          data-slot="poster"
          src="/arcade3d/poster-1600.webp"
          srcset={posterSet("webp")}
          sizes="max(100vw, 179.2vh)"
          width="2752"
          height="1536"
          alt="An abandoned arcade at night. One cabinet still glows blue, its screen reading 404, and a token lies on the floor in front of it."
          fetchpriority="high"
        />
      </picture>
      <canvas ref={canvas} data-slot="canvas" aria-hidden="true" />

      <ArcadeScreen
        ref={(element) => (screenElement = element)}
        state={screenState()}
        layout={layout()}
        reduced={reduced()}
        game={game()}
        gpu={gpu()}
        touch={touch()}
        onBooted={booted}
        onStart={startMenu}
        onSelect={(next) => void choose(next)}
        onFrame={watchFrame}
      />

      <div data-slot="tools">
        <Show when={phase() === "floor" && ready()}>
          <button
            type="button"
            data-slot="insert"
            data-visible={reduced() || touch() ? "" : undefined}
            onClick={insertCoin}
          >
            Insert coin
          </button>
        </Show>
        <Show when={touch() && (phase() === "climb" || phase() === "select")}>
          <button type="button" data-slot="exit" onClick={powerDown}>
            Back
          </button>
        </Show>
        <Show when={phase() === "play"}>
          <button type="button" data-slot="exit" onClick={exit}>
            Exit game <kbd>Esc</kbd>
          </button>
        </Show>
      </div>

      <Show when={phase() === "play" && touch() && game()}>
        {(current) => (
          <ArcadePanel
            game={current()}
            frame={frame()}
            onPause={() => {
              sendKey(frame(), "keydown", "Escape", "Escape")
              sendKey(frame(), "keyup", "Escape", "Escape")
            }}
            onExit={exit}
          />
        )}
      </Show>

      <p data-slot="credit">
        Arcade cabinet based on{" "}
        <a
          href="https://sketchfab.com/3d-models/arcade-machine-5551c32834344b75996d5c911d8d9644"
          target="_blank"
          rel="noopener"
        >
          “Arcade Machine” by MitchellBr
        </a>{" "}
        (Sketchfab),{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">
          CC BY 4.0
        </a>
        , modified.
      </p>

      <p data-slot="status" role="status" aria-live="polite">
        {announce()}
      </p>

      <ArcadeChrome settingsRows={import.meta.env.DEV ? () => <Arcade3DSettings /> : undefined} />
    </div>
  )
}

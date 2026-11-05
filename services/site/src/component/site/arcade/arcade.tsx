import { useI18n } from "~/context/i18n"
import "./arcade.css"
import { createEffect, createSignal, lazy, on, onCleanup, onMount, Show } from "solid-js"
import { siteSettings } from "../settings"
import { createCamera, fit, toScreen, toWorld, type View, type Viewport } from "./camera"
import type { Game } from "./games"
import {
  cabinetZone,
  coinHome,
  coinSize,
  faceplate,
  framing,
  front,
  frontGlass,
  glass,
  scene,
  glassClip,
  plateMask,
  roomMask,
  sceneGlass,
  scenePixel,
  slotCloseup,
  slotCoinSize,
  slotSlit,
  slit,
  type Point,
  type Rect,
} from "./geometry"
import { ArcadeChrome } from "./chrome"
import type { CoinLayer } from "./coin3d"
import { dropOutcome, escapeAction, powerDownDuration, type ArcadeMoment } from "./flow"
import { sendKey } from "./games"
import { ArcadeLayers } from "./layers"
import { ArcadePanel } from "./panel"
import { isPhone } from "./phone"
import { ArcadeScreen, mobileCopy, type ScreenState } from "./screen"
import { homography, unitPoint } from "./homography"
import { coinLight, coinPreview, coinReplay, coinValues, loadCoinValues } from "./coin-tuning"
import { layerValues } from "./layers-tuning"
import { duckAmbience, play, startAudio, unlockAudio } from "./sound"

// The coin's pose: where it is (world units), how it is turned (degrees) and which layer it is on.
type Coin = {
  at: Point
  /** Extra size while held, as if lifted toward the camera. */
  lift: number
  tiltX: number
  turnY: number
  spin: number
  /** Lean in the screen plane, degrees: lines the edge-on token up with the slit. */
  roll: number
  /** "behind" slides it under the slot faceplate. */
  layer: "front" | "behind"
  dim: number
  visible: boolean
}

const sceneSources = [960, 1600, 2752]
// How much larger than life a phone draws the token, so a finger can find it.
const phoneCoin = 2.4
// The image version's Settings rows, loaded with the panel (development only, like Settings).
const ImageSettings = import.meta.env.DEV
  ? lazy(() => import("./settings").then((module) => ({ default: module.ImageArcadeSettings })))
  : () => undefined
// Mode "layers" adds its light and dust rows (404 arcade › Layers).
const LayersSettings = import.meta.env.DEV ? lazy(() => import("./layers-settings")) : () => undefined
// The token's poses and the fade timings (404 arcade › Coin).
const CoinSettings = import.meta.env.DEV ? lazy(() => import("./coin-settings")) : () => undefined
// three.js is browser-only: in the server build this is undefined, so the coin's WebGL module never
// enters the Worker's bundle (its module start-up breaks the Worker; test/server-bundle.test.ts).
const loadCoin3d = import.meta.env.SSR ? undefined : () => import("./coin3d")
// A framing zoomed in by `factor` about its centre (Settings › Door zoom, Screen zoom).
const zoomed = (rect: Rect, factor: number): Rect => ({
  x: rect.x + (rect.w - rect.w / factor) / 2,
  y: rect.y + (rect.h - rect.h / factor) / 2,
  w: rect.w / factor,
  h: rect.h / factor,
})
// The hybrid's slot lamp glow, around its slit (world units).
const slotGlowRect: Rect = { x: slotSlit.x - 220, y: slotSlit.y - 220, w: 440, h: 440 }
// The room's painted opening (screen-mask.json) in the screen's own box: through the inverse of the
// box → painted-quad mapping, so the clip lands on the painting exactly, whatever the camera does.
const roomOutline = roomMask.map((point) => unitPoint(sceneGlass, point)).map(({ x, y }) => [x * 100, y * 100])
const plateOutline = plateMask.map(([x, y]) => [((x - glass.x) / glass.w) * 100, ((y - glass.y) / glass.h) * 100])
const percent = (points: number[][]) =>
  `polygon(${points.map(([x, y]) => `${x.toFixed(3)}% ${y.toFixed(3)}%`).join(", ")})`
const roomClip = percent(roomOutline)
// The same outlines as SVG paths in a 100 × 100 box, for the lip's shadow and the debug outline.
const outlinePath = (points: number[][]) => `M${points.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join("L")}Z`
const roomPath = outlinePath(roomOutline)
const platePath = outlinePath(plateOutline)
// Before hydration the room shot covers the stage (object-fit: cover) with an empty painted glass:
// this runs as the page is parsed and pins the server-rendered screen ("404 / INSERT COIN") onto it
// with the same mapping the live page uses, so the first paint already shows the screen, in the
// same place and size as once the page is live (no empty flash, no jump).
const firstPaintScript = `(() => {
  const screen = document.currentScript.previousElementSibling
  const stage = screen && screen.closest('[data-slot="stage"]')
  if (!stage) return
  const scene = ${JSON.stringify(scene)}
  const quad = ${JSON.stringify(sceneGlass.map((point) => [point.x, point.y]))}
  const width = stage.clientWidth, height = stage.clientHeight
  const scale = Math.max(width / scene.w, height / scene.h)
  const cx = scene.x + scene.w / 2, cy = scene.y + scene.h / 2
  const [p0, p1, p2, p3] = quad.map(([x, y]) => [(x - cx) * scale + width / 2, (y - cy) * scale + height / 2])
  Object.assign(screen.style, { display: "block", position: "absolute", left: "0", top: "0", zIndex: "5", transformOrigin: "0 0", clipPath: ${JSON.stringify(roomClip)} })
  const w = screen.offsetWidth, h = screen.offsetHeight
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0]
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1]
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9
  const g = (dx3 * dy2 - dx2 * dy3) / den, k = (dx1 * dy3 - dx3 * dy1) / den
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + k * p3[0]
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + k * p3[1]
  screen.style.transform = "matrix3d(" + [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, p0[0], p0[1], 0, 1].join(",") + ")"
})()`
const srcset = (name: string, widths: number[], type: string) =>
  widths.map((width) => `/arcade404/${name}-${width}.${type} ${width}w`).join(", ")

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t
// The fades to and from black (CSS easing): in slowly, out gently.
const easeIn = "cubic-bezier(0.55, 0, 1, 0.45)"
const easeOut = "cubic-bezier(0.22, 1, 0.36, 1)"
const inside = (rect: Rect, point: Point) =>
  point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h

/**
 * The 404 page's arcade: a token on the floor of an abandoned arcade. Drag it onto the cabinet to
 * zoom to the coin door, drop it into the slot, and the camera climbs to the screen, where the
 * Anomaly Arcade games are one press away. Every layer lives in one world space (geometry.ts),
 * and a spring camera moves over it.
 *
 * The "hybrid" mode keeps the stills but draws the token with three.js (coin3d.ts) and pins the
 * code-drawn screen onto the painted one in every shot, wide shot included (homography.ts).
 */
export function Arcade404(props: { mode?: "image" | "hybrid" | "layers" }) {
  const i18n = useI18n()
  // "layers" is the hybrid with the room split into layers and its light drawn live (layers.tsx).
  const hybrid = props.mode === "hybrid" || props.mode === "layers"
  // Where the token goes in and how big it is: the hybrid's slot is the room shot's, seen close up.
  const slot = hybrid ? slotSlit : slit
  const tokenSize = hybrid ? slotCoinSize : coinSize
  const [phase, setPhase] = createSignal<ArcadeMoment>("floor")
  const [screenState, setScreenState] = createSignal<ScreenState>("404")
  const [game, setGame] = createSignal<Game>()
  const [gpu, setGpu] = createSignal<boolean>()
  const [frame, setFrame] = createSignal<HTMLIFrameElement>()
  const [live, setLive] = createSignal(false)
  const [reduced, setReduced] = createSignal(false)
  const [touch, setTouch] = createSignal(false)
  const [portrait, setPortrait] = createSignal(false)
  const [frontReady, setFrontReady] = createSignal(false)
  const [layout, setLayout] = createSignal(0.8)
  const [announce, setAnnounce] = createSignal("")
  const [poweringDown, setPoweringDown] = createSignal(false)
  const [coin3d, setCoin3d] = createSignal(false)
  // Phones (phone.ts): the still only. No three.js, no cabinet plate; the coin goes in on the room
  // shot and the screen there powers on with a message instead of the games.
  const [phone, setPhone] = createSignal(false)
  // ?debug=screen: the traced glass opening outlined over the painting (screen-mask.json).
  const [debugScreen, setDebugScreen] = createSignal(false)

  let stage: HTMLDivElement | undefined
  let sceneImage: HTMLElement | undefined
  let closeup: HTMLImageElement | undefined
  let frontImage: HTMLImageElement | undefined
  let plate: HTMLImageElement | undefined
  let screenElement: HTMLDivElement | undefined
  let coinElement: HTMLButtonElement | undefined
  let coinCanvas: HTMLCanvasElement | undefined
  let coinLayer: CoinLayer | undefined
  let coinLoading = false
  let disposed = false
  let slotGlow: HTMLDivElement | undefined
  // The hybrid's token going into the slit: only what is inside the slit stays visible.
  let sinking = false
  // The hybrid's screen: painted on the cabinet in the room shot, or straight on in the select
  // framing (the cabinet plate). It switches while the stage is black (credit, powerDown).
  let facing = false
  // The black over the stage for the fades.
  let fade: HTMLDivElement | undefined

  const viewport: Viewport = { width: 1440, height: 900 }
  const camera = createCamera({ x: scene.x + scene.w / 2, y: scene.y + scene.h / 2, scale: 1440 / scene.w })
  const coin: Coin = {
    at: { ...coinHome },
    lift: 1,
    tiltX: 74,
    turnY: 0,
    spin: -18,
    roll: 0,
    layer: "front",
    dim: 0,
    visible: true,
  }
  let coinShown = true
  let pointer: Point | undefined
  // The plate's opacity, kept at its high point once the camera is on the cabinet.
  let held = 0
  let frameRequest = 0
  let last = 0
  const timers: ReturnType<typeof setTimeout>[] = []
  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms))
  // Short tweens of the coin's pose, advanced by the camera loop.
  let tweens: { from: Coin; to: Partial<Coin>; start: number; duration: number; ease: (t: number) => number }[] = []

  // Framings for the current viewport. Portrait phones frame the cabinet. Once the screen faces the
  // viewer it fills the view below the tools (select), the framing games play in too; on a touch
  // screen the game moves to the top half, over the control panel.
  const views = () => {
    const select = fit(framing.play, viewport, "contain", {
      x: 16,
      y: 64,
      w: viewport.width - 32,
      h: viewport.height - 96,
    })
    return {
      floor: portrait() ? fit(framing.sceneTall, viewport, "cover") : fit(framing.sceneWide, viewport, "cover"),
      door: hybrid ? angledDoor() : fit(zoomed(framing.door, siteSettings.arcadeDoorZoom), viewport),
      select,
      play:
        touch() && portrait()
          ? fit(framing.play, viewport, "contain", {
              x: 8,
              y: 56,
              w: viewport.width - 16,
              h: viewport.height * 0.5 - 64,
            })
          : select,
    }
  }

  // The hybrid inserts the coin in the room shot, close on the slot (5 screen pixels per painted
  // pixel, 3.6 on a portrait phone), where the 4× close-up (slotCloseup) keeps it sharp.
  const angledDoor = (): View => ({
    x: slotSlit.x,
    y: slotSlit.y + 60,
    scale: ((portrait() ? 3.6 : 5) * siteSettings.arcadeDoorZoom) / scenePixel,
  })
  // A phone's view of the painted screen: as wide as the viewport allows, short of blurring the still.
  const phoneScreen = (): View => ({
    ...paintedCentre(),
    scale: Math.min(1.7 / scenePixel, (viewport.width - 40) / (sceneGlass[1].x - sceneGlass[0].x)),
  })
  const paintedCentre = () => ({
    x: sceneGlass.reduce((sum, point) => sum + point.x, 0) / 4,
    y: sceneGlass.reduce((sum, point) => sum + point.y, 0) / 4,
  })

  const go = (view: View, speed: number) => {
    if (reduced()) camera.jump(view)
    else camera.to(view, speed * siteSettings.arcadeCameraSpeed)
    wake()
  }

  // ——— Rendering ———

  const place = (element: HTMLElement | undefined, rect: Rect, layoutWidth: number) => {
    if (!element) return
    const view = camera.view
    const corner = toScreen(view, viewport, rect)
    const k = (rect.w * view.scale) / layoutWidth
    element.style.transform = `translate3d(${corner.x}px, ${corner.y}px, 0) scale(${k})`
  }

  const render = () => {
    const view = camera.view
    if (hybrid) return renderHybrid(view)
    place(sceneImage, scene, 2752)
    place(frontImage, front, 3072)
    place(plate, faceplate, faceplate.w)
    place(screenElement, glass, glass.w * layout())
    clipScreen(glassClip, platePath)
    // The straight-on cabinet plate takes over from the room shot once it covers the viewport,
    // blending over a short stretch of the zoom (registered on the coin slot).
    const covers = Math.max(viewport.width / front.w, viewport.height / front.h) * 1.04
    // Once the camera has reached the cabinet it stays on this plate (the climb never zooms out past it).
    const onCabinet = !["floor", "drag"].includes(phase()) || camera.target.scale >= views().door.scale * 0.9
    const blend = frontReady()
      ? onCabinet
        ? Math.max(smooth(covers, covers * 1.45, view.scale), held)
        : smooth(covers, covers * 1.45, view.scale)
      : 0
    held = onCabinet ? blend : 0
    for (const element of [frontImage, plate, screenElement]) if (element) element.style.opacity = `${blend}`
    renderCoin(view)
  }

  // The hybrid shows either the room shot, with the code-drawn screen pinned on the painted glass,
  // or the straight-on cabinet plate in the select framing; it changes between them under black.
  const renderHybrid = (view: View) => {
    const quad = (points: typeof frontGlass) =>
      points.map((point) => toScreen(view, viewport, point)) as typeof frontGlass
    if (facing) {
      place(frontImage, front, 3072)
      setScreen(quad(frontGlass))
    }
    if (!facing) {
      place(sceneImage, scene, 2752)
      place(slotGlow, slotGlowRect, 200)
      place(closeup, slotCloseup, 2048)
      setScreen(quad(sceneGlass))
    }
    clipScreen(facing ? glassClip : roomClip, facing ? platePath : roomPath)
    if (sceneImage) sceneImage.style.opacity = facing ? "0" : "1"
    // Past the room shot's sharpness (about 1.8× its pixels), its 4× close-up of the coin door
    // takes over, registered on the same pixels, so the slot only gets sharper.
    if (closeup)
      closeup.style.opacity = `${!facing && closeup.complete && closeup.naturalWidth ? Math.max(smooth(1.3, 2.1, view.scale * scenePixel), 0.001) : 0}`
    // Never fully 0 once warmed: the plate stays decoded and on the GPU (see warmFront).
    if (frontImage) frontImage.style.opacity = facing ? (frontReady() ? "1" : "0") : `${frontWarm}`
    if (plate) plate.style.opacity = "0"
    renderCoin(view)
  }

  // The screen's outline: the plate's traced glass straight on, the room's tighter corners in the room.
  let clipped = ""
  const clipScreen = (clip: string, path: string) => {
    if (!screenElement || clip === clipped) return
    clipped = clip
    screenElement.style.clipPath = clip
    for (const element of screenElement.querySelectorAll('[data-slot="lip"] path')) element.setAttribute("d", path)
  }

  const setScreen = (corners: typeof frontGlass) => {
    if (!screenElement) return
    screenElement.style.transform = homography(glass.w * layout(), glass.h * layout(), corners)
    screenElement.style.opacity = "1"
  }

  /** Fades the stage to black (or back) from wherever the fade is now. */
  const fadeTo = (black: boolean, duration: number, easing: string) => {
    if (!fade) return
    const from = getComputedStyle(fade).opacity
    fade.getAnimations().forEach((animation) => animation.cancel())
    fade.style.opacity = black ? "1" : "0"
    fade.animate([{ opacity: from }, { opacity: black ? 1 : 0 }], { duration, easing })
  }

  /** Out to black, swap what is behind it, back up: the coin → screen cut and the way back. */
  const fadeThrough = (swap: () => void) => {
    const timing = reduced() ? { out: 150, hold: 0, up: 200 } : coinValues.fade
    fadeTo(true, timing.out, easeIn)
    later(timing.out + timing.hold, () => {
      swap()
      render()
      fadeTo(false, timing.up, easeOut)
    })
    return timing.out + timing.hold + timing.up
  }

  const renderCoin = (view: View) => {
    if (!coinElement) return
    // Once the token is gone (in the slot), its layers keep their last, empty frame.
    if (!coin.visible && !coinShown) return
    coinShown = coin.visible
    const at = pointer && phase() === "drag" ? magnet(view) : toScreen(view, viewport, coin.at)
    const size = Math.max(
      tokenSize * siteSettings.arcadeCoinSize * view.scale * coin.lift * (phone() ? phoneCoin : 1),
      coin.lift > 1 ? 16 : 0,
    )
    coinElement.style.setProperty("--size", `${size}px`)
    coinElement.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`
    coinElement.style.setProperty("--tilt", `${coin.tiltX}deg`)
    coinElement.style.setProperty("--turn", `${coin.turnY}deg`)
    coinElement.style.setProperty("--spin", `${coin.spin}deg`)
    coinElement.style.setProperty("--dim", `${coin.dim}`)
    coinElement.style.setProperty("--perspective", `${coinValues.held.perspective}`)
    coinElement.style.rotate = `${coin.roll}deg`
    coinElement.style.zIndex = coin.layer === "behind" ? "3" : "6"
    coinElement.style.visibility = coin.visible ? "visible" : "hidden"
    // Sliding in, only the part still outside the slit shows: everything on the room side of the
    // slit's line (leaned like the painted slit), so the token vanishes into it, not over the door.
    const clip = hybrid && sinking ? slitClip(view) : undefined
    const box = Math.max(size, 44)
    coinElement.style.clipPath = clip
      ? `polygon(${clip.map((point) => `${point.x - at.x + box / 2}px ${point.y - at.y + box / 2}px`).join(", ")})`
      : ""
    if (!coinLayer || !coinCanvas) return
    coinCanvas.style.zIndex = coin.layer === "behind" ? "3" : "6"
    coinCanvas.style.clipPath = clip ? `polygon(${clip.map((point) => `${point.x}px ${point.y}px`).join(", ")})` : ""
    const atDoor = view.scale > views().door.scale * 0.7
    coinLayer.draw({
      near: phase() === "inserting" ? 1 : phase() === "drag" && atDoor ? slotPull(view, at).pull : 0,
      lamp: toScreen(view, viewport, slot),
      x: at.x,
      y: at.y,
      size,
      tilt: coin.tiltX,
      turn: coin.turnY,
      spin: coin.spin,
      roll: coin.roll,
      dim: coin.dim,
      visible: coin.visible,
    })
  }

  // The outside of the slit, in stage px: the half-plane right of its leaned line (the cabinet
  // faces right of the viewer, so going in moves the token left), as tall as the slit.
  const slitClip = (view: View) => {
    const centre = toScreen(view, viewport, slot)
    const lean = (coinValues.slot.lean * Math.PI) / 180
    const up = { x: Math.sin(lean), y: -Math.cos(lean) }
    const right = { x: Math.cos(lean), y: Math.sin(lean) }
    const half = 72 * view.scale
    const far = 4000
    return [
      { x: centre.x + up.x * half, y: centre.y + up.y * half },
      { x: centre.x + up.x * half + right.x * far, y: centre.y + up.y * half + right.y * far },
      { x: centre.x - up.x * half + right.x * far, y: centre.y - up.y * half + right.y * far },
      { x: centre.x - up.x * half, y: centre.y - up.y * half },
    ]
  }

  // The hybrid's three.js token replaces the CSS one once it has loaded (the CSS one stays as the
  // hit area, and as the coin if WebGL is unavailable).
  const loadCoin = () => {
    const canvas = coinCanvas
    if (!hybrid || phone() || coinLoading || !canvas || !loadCoin3d) return
    coinLoading = true
    loadCoin3d()
      .then((module) => module.createCoinLayer(canvas, () => render()))
      .then((layer) => {
        if (disposed) return layer.dispose()
        coinLayer = layer
        layer.setLight(coinLight())
        layer.resize(viewport.width, viewport.height)
        setCoin3d(true)
        render()
      })
      .catch(() => {})
  }

  // Over the coin door the slot pulls the coin in from well around it (a generous target), turning
  // it edge-on as it closes in; a drop anywhere there is accepted (flow.ts).
  const slotPull = (view: View, from: Point) => {
    const target = toScreen(view, viewport, slot)
    const reach = tokenSize * view.scale
    const distance = Math.hypot(from.x - target.x, from.y - target.y)
    return { target, pull: smooth(reach * 4, reach * 0.6, distance) }
  }

  const magnet = (view: View): Point => {
    if (!pointer) return toScreen(view, viewport, coin.at)
    if (phase() !== "drag" || view.scale < views().door.scale * 0.7) return pointer
    const { target, pull } = slotPull(view, pointer)
    return { x: mix(pointer.x, target.x, pull * 0.7), y: mix(pointer.y, target.y, pull * 0.7) }
  }

  const tick = (now: number) => {
    frameRequest = 0
    // Capped, so a frame after a stall (a background tab) does not jump; slow devices still keep time.
    const dt = Math.min(0.1, (now - (last || now)) / 1000)
    last = now
    const moving = camera.step(dt)
    tweens = tweens.filter((tween) => {
      const t = Math.min(1, (now - tween.start) / tween.duration)
      const e = tween.ease(t)
      for (const name of ["lift", "tiltX", "turnY", "spin", "roll", "dim"] as const) {
        const target = tween.to[name]
        if (target !== undefined) coin[name] = mix(tween.from[name], target, e)
      }
      if (tween.to.at)
        coin.at = { x: mix(tween.from.at.x, tween.to.at.x, e), y: mix(tween.from.at.y, tween.to.at.y, e) }
      return t < 1
    })
    if (phase() === "drag" && pointer) {
      const view = camera.view
      const { pull } = slotPull(view, pointer)
      const atDoor = view.scale > views().door.scale * 0.7
      // Held in its held pose (404 arcade › Coin); over the door it turns toward the slot's angle
      // only in the last stretch, so the face stays readable on the way.
      if (!tweens.length) holdPose(atDoor ? pull ** 3 : 0)
      coin.at = toWorld(view, viewport, magnet(view))
    }
    render()
    if (moving || tweens.length || phase() === "drag") wake()
    else last = 0
  }

  // The held pose, turned `toward` (0–1) the slot's.
  const holdPose = (toward: number) => {
    coin.tiltX = mix(coinValues.held.tilt, coinValues.slot.tilt, toward)
    coin.turnY = mix(coinValues.held.turn, coinValues.slot.turn, toward)
    coin.spin = mix(coinValues.held.spin, coinValues.slot.spin, toward)
    coin.roll = coinValues.slot.lean * toward
  }

  const wake = () => {
    if (!frameRequest) frameRequest = requestAnimationFrame(tick)
  }

  const tween = (to: Partial<Coin>, duration: number, ease = (t: number) => 1 - Math.pow(1 - t, 3)) => {
    if (reduced()) {
      Object.assign(coin, to)
      render()
      return
    }
    tweens.push({ from: { ...coin, at: { ...coin.at } }, to, start: performance.now(), duration, ease })
    wake()
  }

  // ——— Coin interaction ———

  // The 17-megapixel cabinet plate is decoded, uploaded and rastered at the select framing's scale
  // ahead of time (it would otherwise decode on the frame it first shows, mid-turn), then kept at an
  // invisible opacity rather than 0, which would let the browser drop it.
  let frontWarm = 0
  const warmFront = () => {
    const image = frontImage
    if (!hybrid || !image || frontWarm) return
    void image
      .decode()
      .catch(() => {})
      .then(() => {
        if (disposed || facing) return
        frontWarm = 0.001
        const view = views().select
        const corner = toScreen(view, viewport, front)
        image.style.transform = `translate3d(${corner.x}px, ${corner.y}px, 0) scale(${view.scale})`
        image.style.opacity = `${frontWarm}`
      })
  }

  const loadFront = () => {
    if (phone()) return
    if (closeup) closeup.loading = "eager"
    if (frontReady() || !frontImage) return
    frontImage.loading = "eager"
    if (!frontImage.complete || !frontImage.naturalWidth) return
    setFrontReady(true)
    warmFront()
  }

  // On a phone the token lifts only once the finger has moved a little, so a tap or a swipe that
  // starts on it does not grab it.
  let press: { id: number; at: Point } | undefined

  const pickUp = (event: PointerEvent) => {
    if (phase() !== "floor" || coinPreview()) return
    if (reduced()) return
    if (phone() && !press) {
      press = { id: event.pointerId, at: clientPoint(event) }
      return
    }
    press = undefined
    event.preventDefault()
    unlockAudio()
    loadFront()
    loadCoin()
    coinElement?.setPointerCapture(event.pointerId)
    pointer = clientPoint(event)
    setPhase("drag")
    coin.layer = "front"
    const held = coinValues.held
    tween({ lift: 2.4, tiltX: held.tilt, turnY: held.turn, spin: held.spin, roll: 0 }, held.pickup)
    play("coin-pickup")
    navigator.vibrate?.(6)
    wake()
  }

  const clientPoint = (event: PointerEvent): Point => {
    const box = stage?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  const dragMove = (event: PointerEvent) => {
    if (press && event.pointerId === press.id) {
      const at = clientPoint(event)
      if (Math.hypot(at.x - press.at.x, at.y - press.at.y) > 8) pickUp(event)
    }
    if (phase() !== "drag") return
    pointer = clientPoint(event)
    const view = camera.view
    const world = toWorld(view, viewport, pointer)
    // A phone stays on the room shot: the slot lamp lights while the token is over the cabinet.
    if (phone()) {
      if (slotGlow) slotGlow.style.opacity = inside(cabinetZone, world) ? "0.7" : "0"
      return wake()
    }
    const doorView = views().door
    // Over the cabinet, the camera dollies in to the coin door while the coin stays in hand.
    if (camera.target.scale < doorView.scale * 0.9 && inside(cabinetZone, world)) {
      go(doorView, 2.6)
      tween({ lift: 1.05 }, 900)
    }
    wake()
  }

  const drop = (event: PointerEvent) => {
    press = undefined
    if (phase() !== "drag") return
    pointer = clientPoint(event)
    const view = camera.view
    coin.at = toWorld(view, viewport, magnet(view))
    pointer = undefined
    if (slotGlow) slotGlow.style.opacity = ""
    // On a phone anywhere on the cabinet takes the token: the slot is a few pixels across there.
    const over = phone() ? inside(cabinetZone, coin.at) : camera.target.scale >= views().door.scale * 0.9
    if (dropOutcome(over) === "insert") return insert()
    // Let go away from the machine: it settles back where it lay.
    setPhase("floor")
    tween({ at: coinHome, lift: 1, tiltX: 74, spin: -18, turnY: 0, roll: 0 }, 450, bounce)
  }

  const bounce = (t: number) => {
    if (t < 0.7) return (t / 0.7) ** 2
    const u = (t - 0.7) / 0.3
    return 1 - Math.sin(u * Math.PI) * 0.08
  }

  /**
   * The token goes in. The hybrid lines it up with the painted slit (edge-on, turned and leaned like
   * the slot, 404 arcade › Coin › Insert), then slides it in, clipped by the slit so it disappears
   * inside, while the slot lamp answers. The image version slides it behind the faceplate.
   */
  const insert = (then: () => void = credit) => {
    setPhase("inserting")
    unlockAudio()
    loadFront()
    if (reduced()) {
      coin.visible = false
      render()
      return then()
    }
    const timing = coinValues.slot
    if (hybrid) {
      // A phone draws the token larger than life to be grabbed; it shrinks to the slot's size.
      const seat = phone() ? 1 / phoneCoin : 1
      const depth = tokenSize * 0.55
      const lean = (timing.lean * Math.PI) / 180
      const along = (distance: number) => ({
        x: slot.x + Math.cos(lean) * distance,
        y: slot.y + Math.sin(lean) * distance,
      })
      tween(
        {
          at: along(depth * 0.5),
          lift: seat,
          tiltX: timing.tilt,
          turnY: timing.turn,
          spin: timing.spin,
          roll: timing.lean,
        },
        timing.align,
      )
      later(timing.align, () => {
        play("coin-insert")
        sinking = true
        slotGlow?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], {
          duration: timing.slide + 400,
          easing: "ease-out",
        })
        tween({ at: along(-depth), lift: seat * 0.94, dim: 0.5 }, timing.slide, (t) => t * t)
      })
      later(timing.align + timing.slide, () => {
        coin.visible = false
        sinking = false
        navigator.vibrate?.([14, 50, 22])
        then()
      })
      return
    }
    tween({ at: slot, turnY: 90, lift: 1, tiltX: 0, spin: 4 }, 160)
    later(330, () => {
      play("coin-insert")
      coin.layer = "behind"
      tween({ at: { x: slit.x, y: slit.y + coinSize * 1.25 }, dim: 0.75 }, 380, (t) => t * t)
    })
    later(720, () => {
      coin.visible = false
      plate?.animate(
        [
          { filter: "saturate(var(--tone-sat-pct)) brightness(1)" },
          { filter: "saturate(var(--tone-sat-pct)) brightness(2.2)" },
          { filter: "saturate(var(--tone-sat-pct)) brightness(1)" },
        ],
        { duration: 520, easing: "ease-out" },
      )
      navigator.vibrate?.([14, 50, 22])
      then()
    })
  }

  // ——— After the credit ———

  // The credit wakes the machine: the stage fades to black and comes back up on the screen, straight
  // on in the select framing, reading "404" (the coin is in). The 404 tears and the cabinet boots
  // (it cannot be skipped), then the start screen hands over to the game menu. A phone comes back up
  // on the painted screen, powering on with its message.
  const credit = () => {
    play("power-up", 0.25)
    setAnnounce(i18n.t("site.arcade.credit"))
    setPhase("climb")
    const shown = fadeThrough(() => {
      if (phone()) {
        camera.jump(phoneScreen())
        setScreenState("mobile")
        setPhase("select")
        play("start")
        const copy = mobileCopy[siteSettings.arcadeMobileCopy]
        setAnnounce(`${copy.title} ${copy.lines.join(". ")}.`)
        return
      }
      facing = true
      camera.jump(views().select)
    })
    if (phone()) return
    if (reduced()) return later(shown, () => setScreenState("boot"))
    later(shown + coinValues.fade.still, () => {
      setScreenState("glitch")
      play("glitch")
    })
    later(shown + coinValues.fade.still + siteSettings.arcadeGlitch, () => setScreenState("boot"))
  }

  const booted = () => {
    setScreenState("start")
    setPhase("select")
    play("start")
    setAnnounce(i18n.t("site.arcade.pressStart"))
    // The start screen waits for a press, and moves on by itself after a few seconds.
    if (siteSettings.arcadeStartDelay > 0)
      later(siteSettings.arcadeStartDelay, () => screenState() === "start" && startMenu())
  }

  const startMenu = () => {
    if (screenState() !== "start") return
    setScreenState("select")
    setAnnounce(i18n.t("site.arcade.selectGame"))
  }

  const choose = async (next: Game) => {
    duckAmbience(true)
    setGame(next)
    setPhase("play")
    setScreenState("play")
    go(views().play, 3.4)
    // Some browsers expose `navigator.gpu` without an adapter, or not at all.
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
    go(views().select, 3.4)
  }

  /** Back to the room: the screen powers down, the stage fades through black to the cabinet and the token is on the floor again. */
  const powerDown = () => {
    if (poweringDown()) return
    for (const timer of timers.splice(0)) clearTimeout(timer)
    tweens = []
    sinking = false
    duckAmbience(false)
    play("power-off")
    setAnnounce(i18n.t("site.arcade.poweredDown"))
    if (!reduced()) setPoweringDown(true)
    later(reduced() ? 0 : powerDownDuration, () =>
      fadeThrough(() => {
        setPoweringDown(false)
        setScreenState("404")
        setGame(undefined)
        setFrame(undefined)
        setGpu(undefined)
        resetCoin()
        setPhase("floor")
        facing = false
        camera.jump(views().floor)
        // Keyboard users continue from the token.
        requestAnimationFrame(() => coinElement?.focus({ preventScroll: true }))
      }),
    )
  }

  const resetCoin = () =>
    Object.assign(coin, {
      at: { ...coinHome },
      lift: 1,
      tiltX: 74,
      turnY: 0,
      spin: -18,
      roll: 0,
      layer: "front",
      dim: 0,
      visible: true,
    })

  // Settings › Coin › Preview: the token held still over the coin door in its held pose, live as the
  // sliders move; off, it is back on the floor. Replay insert slides it in again, then back to the
  // preview (no credit).
  const previewAt = () => ({ x: slot.x + tokenSize * 1.6, y: slot.y - tokenSize * 0.4 })
  const showPreview = () => {
    tweens = []
    sinking = false
    Object.assign(coin, { at: previewAt(), lift: 1.05, layer: "front", dim: 0, visible: true })
    holdPose(0)
    if (!phone()) camera.jump(views().door)
    render()
  }
  createEffect(
    on(
      coinPreview,
      (on) => {
        if (phase() !== "floor") return
        if (on) return showPreview()
        resetCoin()
        camera.jump(views().floor)
        render()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => JSON.stringify(coinValues) + JSON.stringify(layerValues.beam),
      () => {
        coinLayer?.setLight(coinLight())
        render()
        if (coinPreview() && phase() === "floor") showPreview()
        if (phase() === "drag") wake()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      coinReplay,
      () => {
        if (phase() !== "floor" || facing) return
        showPreview()
        insert(() => {
          setPhase("floor")
          later(400, () => (coinPreview() ? showPreview() : (resetCoin(), camera.jump(views().floor), render())))
        })
      },
      { defer: true },
    ),
  )

  // The coin size applies at once, even while nothing moves.
  createEffect(
    on(
      () => siteSettings.arcadeCoinSize,
      () => render(),
      { defer: true },
    ),
  )

  // Zoom settings apply at once to where the camera is.
  createEffect(
    on(
      () => siteSettings.arcadeDoorZoom,
      () => {
        if (phase() === "inserting") go(views().door, 4)
      },
      { defer: true },
    ),
  )

  // ——— Lifecycle ———

  const measure = () => {
    if (!stage) return
    viewport.width = stage.clientWidth
    viewport.height = stage.clientHeight
    setPortrait(viewport.height > viewport.width * 1.1)
    // The screen is laid out at the play zoom, so the game frame renders 1:1 while playing.
    setLayout(views().play.scale)
    coinLayer?.resize(viewport.width, viewport.height)
    const target = (() => {
      const current = phase()
      if (current === "floor" || current === "drag")
        return camera.target.scale > views().door.scale * 0.7 ? views().door : views().floor
      if (phone()) return current === "inserting" ? views().floor : phoneScreen()
      if (current === "inserting") return views().door
      // The hybrid's screen is still on the cabinet in the room shot.
      if (hybrid && !facing) return views().door
      if (current === "play") return views().play
      return views().select
    })()
    camera.jump(target)
    render()
  }

  onMount(() => {
    const stopAudio = startAudio()
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    const coarse = matchMedia("(pointer: coarse)")
    setReduced(motion.matches)
    setPhone(hybrid && isPhone())
    setDebugScreen(new URLSearchParams(location.search).get("debug") === "screen")
    loadCoinValues()
    setTouch(coarse.matches)
    const onMotion = () => setReduced(motion.matches)
    motion.addEventListener("change", onMotion)
    const observer = new ResizeObserver(measure)
    if (stage) observer.observe(stage)
    measure()
    setLive(true)
    // The cabinet plate is only needed once the coin moves; fetch it after first paint.
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 400))
    idle(() => {
      loadFront()
      loadCoin()
    })
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
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
      motion.removeEventListener("change", onMotion)
      observer.disconnect()
      document.removeEventListener("keydown", keys)
      stopAudio()
      disposed = true
      coinLayer?.dispose()
      cancelAnimationFrame(frameRequest)
      for (const timer of timers) clearTimeout(timer)
    })
  })

  // In development the game is same-origin (the proxy), so Escape inside it can also leave the game.
  const watchFrame = (element: HTMLIFrameElement | undefined) => {
    setFrame(element)
    if (!element) return
    element.addEventListener("load", () => {
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
      data-component="arcade-404"
      data-mode={hybrid ? "hybrid" : undefined}
      data-debug-screen={debugScreen() ? "" : undefined}
      data-phone={phone() ? "" : undefined}
      data-coin3d={coin3d() ? "" : undefined}
      data-live={live() ? "" : undefined}
      data-phase={phase()}
      data-reduced={reduced() ? "" : undefined}
      data-touch={touch() ? "" : undefined}
      data-power-down={poweringDown() ? "" : undefined}
      style={{
        "--glisten": siteSettings.arcadeGlisten / 100,
        "--glisten-rate": `${siteSettings.arcadeGlistenRate}s`,
        "--scanlines": siteSettings.arcadeScanlines / 100,
        "--flicker": siteSettings.arcadeFlicker / 100,
        "--glitch-duration": `${siteSettings.arcadeGlitch}ms`,
      }}
    >
      <div ref={stage} data-slot="stage" onPointerMove={dragMove} onPointerUp={drop} onPointerCancel={drop}>
        <Show
          when={props.mode === "layers"}
          fallback={
            <picture>
              <source type="image/avif" srcset={srcset("scene-neutral", sceneSources, "avif")} sizes="100vw" />
              <img
                ref={(element) => (sceneImage = element)}
                data-slot="scene"
                src="/arcade404/scene-neutral-1600.webp"
                srcset={srcset("scene-neutral", sceneSources, "webp")}
                sizes="100vw"
                width="2752"
                height="1536"
                alt={i18n.t("site.arcade.alt")}
                fetchpriority="high"
              />
            </picture>
          }
        >
          <ArcadeLayers ref={(element) => (sceneImage = element)} reduced={reduced()} />
        </Show>
        {/* A phone stays on the room shot: no close-up and no cabinet plate to download. */}
        <Show when={hybrid && !phone()}>
          <picture>
            <source type="image/avif" srcset="/arcade404/slot-neutral-2048.avif" />
            <img
              ref={closeup}
              data-slot="closeup"
              src="/arcade404/slot-neutral-2048.webp"
              width="2048"
              height="1536"
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => render()}
            />
          </picture>
        </Show>
        <Show when={!phone()}>
          <picture>
            <source type="image/avif" srcset="/arcade404/front-neutral-3072.avif" />
            <img
              ref={frontImage}
              data-slot="front"
              src="/arcade404/front-neutral-3072.webp"
              width="3072"
              height="5504"
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => {
                setFrontReady(true)
                warmFront()
                render()
              }}
            />
          </picture>
        </Show>
        <ArcadeScreen
          ref={(element) => (screenElement = element)}
          state={screenState()}
          layout={layout()}
          bootDuration={siteSettings.arcadeBoot}
          reduced={reduced()}
          game={game()}
          gpu={gpu()}
          touch={touch()}
          onBooted={booted}
          onStart={startMenu}
          onSelect={(next) => void choose(next)}
          onFrame={watchFrame}
        />
        <script innerHTML={firstPaintScript} />
        <img
          ref={plate}
          data-slot="faceplate"
          src="/arcade404/faceplate-neutral.webp"
          alt=""
          width="202"
          height="214"
        />
        <div data-slot="balance" aria-hidden="true" />
        <Show when={hybrid}>
          <div ref={slotGlow} data-slot="slot-glow" aria-hidden="true" />
          {/* Graded like the stills around it (the page's saturation, and the layers' grade). */}
          <canvas
            ref={coinCanvas}
            data-slot="coin-canvas"
            aria-hidden="true"
            style={{
              filter:
                props.mode === "layers"
                  ? `saturate(calc(var(--tone-sat-pct) * ${layerValues.grade.saturation})) brightness(${layerValues.grade.brightness})`
                  : "saturate(var(--tone-sat-pct))",
            }}
          />
        </Show>

        <button
          ref={coinElement}
          type="button"
          data-slot="coin"
          aria-label={i18n.t("site.arcade.token")}
          onPointerDown={pickUp}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && phase() === "floor") {
              event.preventDefault()
              keyboardInsert()
            }
          }}
        >
          <span data-slot="body">
            <span data-slot="edge" />
            <span data-slot="edge" />
            <span data-slot="edge" />
            <span data-slot="edge" />
            <span data-slot="edge" />
            <span data-slot="face" />
            <span data-slot="back" />
            <span data-slot="rim" />
            <span data-slot="sheen" />
          </span>
          <span data-slot="sparkle" />
          <span data-slot="sparkle" />
          <span data-slot="sparkle" />
        </button>
        <div ref={fade} data-slot="fade" aria-hidden="true" />
      </div>

      <div data-slot="tools">
        <Show when={(reduced() || touch()) && phase() === "floor"}>
          <button type="button" data-slot="insert" onClick={keyboardInsert}>
            {i18n.t("site.arcade.insertCoin")}
          </button>
        </Show>
        <Show when={phase() === "play"}>
          <button type="button" data-slot="exit" onClick={exit}>
            {i18n.t("site.arcade.exit")} <kbd>Esc</kbd>
          </button>
        </Show>
        <Show when={touch() && escapeAction(phase()) === "power-down"}>
          <button type="button" data-slot="power-down" onClick={powerDown}>
            {i18n.t("site.arcade.back")} <kbd>Esc</kbd>
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

      <p data-slot="status" role="status" aria-live="polite">
        {announce()}
      </p>

      <ArcadeChrome
        settingsRows={
          import.meta.env.DEV
            ? () => (
                <>
                  <ImageSettings />
                  <Show when={props.mode === "layers"}>
                    <LayersSettings />
                  </Show>
                  <CoinSettings />
                </>
              )
            : undefined
        }
      />
    </div>
  )

  // Keyboard, reduced motion and the touch "Insert coin" button: the camera flies the coin in.
  function keyboardInsert() {
    unlockAudio()
    loadFront()
    loadCoin()
    if (reduced()) return insert()
    setPhase("inserting")
    coin.layer = "front"
    // A phone stays on the room shot: the token flies straight to the slot.
    if (phone()) {
      tween({ lift: 1.3, tiltX: 10, spin: 0 }, 300)
      later(300, () => tween({ at: slot, lift: 1, turnY: 60 }, 600))
      later(950, insert)
      return
    }
    tween({ lift: 1.6, tiltX: 10, spin: 0 }, 300)
    go(views().door, 2.6)
    later(900, () => tween({ at: slot, lift: 1, turnY: 60 }, 500))
    later(1450, insert)
  }
}

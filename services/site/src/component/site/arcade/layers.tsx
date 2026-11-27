import { useI18n } from "~/context/i18n"
import "./layers.css"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { createLightLayer, type LayerData } from "./layers-gl"
import { layerValues, loadLayerValues } from "./layers-tuning"

const base = "/arcade404/layers"
const sources = (name: string, type: string) =>
  [1600, 2752].map((width) => `${base}/${name}-${width}.${type} ${width}w`).join(", ")

/**
 * The room for mode "layers" (the 404's default): the painted room without its light, the light and
 * dust, then the painted cabinet on top, all laid out at the room shot's size (2752 × 1536) so
 * arcade.tsx's camera places the stack exactly like the single still. Over it the server renders
 * the poster, the same stack flattened with the light's first frame at the default values, and the
 * grade inline, so the first paint is the finished look. Once the room and cabinet have decoded and
 * the WebGL layer (layers-gl.ts) has drawn that first frame, the poster fades out and the dust
 * starts drifting from where it was. Phones and browsers without WebGL2 keep the poster; reduced
 * motion stays on the first frame.
 */
export function ArcadeLayers(props: { ref: (element: HTMLDivElement) => void; reduced: boolean }) {
  const i18n = useI18n()
  const [live, setLive] = createSignal(false)
  let stack: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    loadLayerValues()
    if (matchMedia("(pointer: coarse) and (max-width: 40rem)").matches || !canvas || !stack) return
    const target = canvas
    const plates = [
      ...stack.querySelectorAll<HTMLImageElement>('[data-slot="layer-room"], [data-slot="layer-cabinet"]'),
    ]
    let disposed = false
    let frame = 0
    let layer: ReturnType<typeof createLightLayer>
    // Seconds of animation shown so far: 0 is the still, and a hidden tab does not jump ahead.
    let clock = 0
    let last = 0

    const draw = (now: number) => {
      frame = 0
      if (!layer || document.hidden) return
      if (last && !props.reduced) clock += Math.min(0.1, (now - last) / 1000)
      last = props.reduced ? 0 : now
      // Hidden once the screen has come forward: nothing to draw.
      if (stack?.style.opacity !== "0") layer.draw(clock, layerValues)
      if (!live()) setLive(true)
      if (!props.reduced) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      if (!frame && layer) frame = requestAnimationFrame(draw)
    }
    const visibility = () => {
      last = 0
      if (!document.hidden) wake()
    }
    document.addEventListener("visibilitychange", visibility)

    Promise.all([
      fetch(`${base}/layers.json`).then((response) => response.json() as Promise<LayerData>),
      image(`${base}/beam.webp`),
      image(`${base}/floor.webp`),
      ...plates.map(loaded),
    ])
      .then(([data, beam, floor]) => {
        if (disposed) return
        layer = createLightLayer(target, data, { beam, floor })
        layer?.resize(Math.min(2, window.devicePixelRatio || 1) / 2)
        wake()
      })
      .catch(() => {})

    // Slider changes redraw at once, also when the loop is paused (reduced motion).
    createEffect(() => {
      JSON.stringify(layerValues)
      wake()
    })
    createEffect(() => {
      void props.reduced
      wake()
    })

    onCleanup(() => {
      disposed = true
      cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", visibility)
      layer?.dispose()
    })
  })

  return (
    <div
      ref={(element) => {
        stack = element
        props.ref(element)
      }}
      data-slot="scene"
      data-layers=""
      data-light-live={live() ? "" : undefined}
      style={{
        filter: `saturate(calc(var(--tone-sat-pct) * ${layerValues.grade.saturation})) brightness(${layerValues.grade.brightness})`,
      }}
    >
      {/* AVIF first, tagged gamma 2.2 like the stills, so browsers show both alike. */}
      <picture>
        <source type="image/avif" srcset={sources("background", "avif")} sizes="100vw" />
        <img
          data-slot="layer-room"
          src={`${base}/background-1600.webp`}
          srcset={sources("background", "webp")}
          sizes="100vw"
          width="2752"
          height="1536"
          alt={i18n.t("site.arcade.alt")}
        />
      </picture>
      <canvas ref={canvas} data-slot="layer-light" width="1376" height="768" aria-hidden="true" />
      <picture>
        <source type="image/avif" srcset={`${base}/cabinet.avif`} />
        <img data-slot="layer-cabinet" src={`${base}/cabinet.webp`} alt="" width="444" height="827" />
      </picture>
      {/* The finished look in one picture (room, the light's first frame, cabinet): the first paint,
          and what phones and browsers without WebGL2 keep. */}
      <picture>
        <source type="image/avif" srcset={sources("poster", "avif")} sizes="100vw" />
        <img
          data-slot="layer-poster"
          src={`${base}/poster-1600.webp`}
          srcset={sources("poster", "webp")}
          sizes="100vw"
          width="2752"
          height="1536"
          alt=""
          fetchpriority="high"
        />
      </picture>
    </div>
  )
}

function image(src: string) {
  const result = new Image()
  result.src = src
  return result.decode().then(() => result)
}

// Loaded and decoded; a source switch mid-decode (srcset) rejects decode(), so wait for load first.
function loaded(plate: HTMLImageElement) {
  const done = plate.complete && plate.naturalWidth > 0
  return (
    done ? Promise.resolve() : new Promise((resolve) => plate.addEventListener("load", resolve, { once: true }))
  ).then(() => plate.decode().catch(() => {}))
}

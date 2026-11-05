import { createEffect, Index, on, Show, type JSX } from "solid-js"
import { mediaUrl } from "~/lib/media"

/**
 * The optimised copies of the site's media in public/media (media-opt/encode.py and images.py next
 * to the checkout): AV1 and HEVC encodes of each product video, and AVIF and WebP stills, right-sized
 * for where they are drawn and content-hashed so they cache for a year. media-manifest.json lists only
 * copies that met the quality bar (VMAF ≥ 95 and SSIM ≥ 0.98 for video, SSIMULACRA2 ≥ 85 for
 * stills) against the original, which stays in place as the last fallback. Bundled at build time.
 */
// Copy names follow one pattern, so the manifest holds only what varies (media-opt/manifest.py):
//   /media/<base>.<width>.<codec>.<hash>.mp4 and /media/<base>.<width>.<hash>.<avif|webp>,
// <base> being the original's path without its leading /product-videos/ (or /) and extension.
type Manifest = {
  // Original → its video copies, AV1 first, then HEVC; a media key marks a size for some screens.
  video: Record<string, [width: number, codec: "av1" | "hevc", hash: string, level: number, media?: MediaKey][]>
  // Original → per format, [width, hash][].
  image: Record<string, Partial<Record<"avif" | "webp", [width: number, hash: string][]>>>
}
type MediaKey = "hi" | "phone"

const manifest: Manifest = Object.values(
  import.meta.glob<Manifest>("./media-manifest.json", { eager: true, import: "default" }),
)[0] ?? { video: {}, image: {} }

const base = (src: string) => `/media/${src.replace(/^\/(product-videos\/)?/, "").replace(/\.\w+$/, "")}`

export type VideoSource = { src: string; type?: string; media?: string }

/**
 * A video's source: the original H.264 file in the files bucket. The manifest's AV1 and HEVC copies
 * were never uploaded, so they are not offered.
 */
export function videoSources(src: string): VideoSource[] {
  return [{ src: mediaUrl(src), type: "video/mp4" }]
}

/** A still's AVIF and WebP srcsets (if it has copies), and the file for `src`: the smallest WebP. */
export function imageSources(src: string) {
  const entry = manifest.image[src]
  const file = (format: "avif" | "webp", [width, hash]: [number, string]) => `${base(src)}.${width}.${hash}.${format}`
  const set = (format: "avif" | "webp") =>
    entry?.[format]?.map((item) => `${file(format, item)} ${item[0]}w`).join(", ")
  const smallest = entry?.webp?.[0]
  return { avif: set("avif"), webp: set("webp"), src: smallest ? file("webp", smallest) : src }
}

/** The file for a video's poster attribute, which takes one URL: the smallest WebP copy. */
export function posterFile(src: string) {
  return imageSources(src).src
}

/** The display sizes the stills are made for, as `sizes` values. */
export const stillSizes = {
  card: "(max-width: 40rem) 90vw, 342px",
  hero: "(min-width: 90rem) 1344px, 100vw",
  clip: "(max-width: 40rem) 90vw, 385px",
}

/**
 * Loads a still the way a <picture> on the page would pick it (AVIF where the browser decodes it,
 * the size for `sizes`), so a later <picture> finds it in the cache.
 */
export function loadStill(src: string, sizes: string) {
  const sources = imageSources(src)
  const picture = document.createElement("picture")
  if (sources.avif) {
    const source = document.createElement("source")
    source.type = "image/avif"
    source.srcset = sources.avif
    source.sizes = sizes
    picture.append(source)
  }
  const image = document.createElement("img")
  if (sources.webp) {
    image.srcset = sources.webp
    image.sizes = sizes
  }
  image.src = sources.src
  picture.append(image)
  return image
}

/**
 * A video's sources (AV1, HEVC, then the original H.264), kept as the same elements when
 * the file changes. The browser picks a source only when it loads, so a new file reloads the video.
 */
export function VideoSources(props: { src: string | undefined; video: () => HTMLVideoElement | undefined }) {
  createEffect(
    on(
      () => props.src,
      () => props.video()?.load(),
      { defer: true },
    ),
  )
  return (
    <Show when={props.src}>
      {(src) => (
        <Index each={videoSources(src())}>
          {(source) => <source src={source().src} type={source().type} media={source().media} />}
        </Index>
      )}
    </Show>
  )
}

/**
 * A still as a <picture>: its AVIF copies, then WebP, each right-sized for `sizes`. The
 * picture has display: contents, so the <img> keeps its place in the layout and its attributes.
 */
export function Still(props: JSX.ImgHTMLAttributes<HTMLImageElement> & { src: string; sizes: string }) {
  const sources = () => imageSources(props.src)
  return (
    <picture data-still>
      <Show when={sources().avif}>{(avif) => <source type="image/avif" srcset={avif()} sizes={props.sizes} />}</Show>
      <img {...props} src={sources().src} srcset={sources().webp} sizes={sources().webp ? props.sizes : undefined} />
    </picture>
  )
}

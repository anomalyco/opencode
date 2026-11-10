import { createEffect, Index, on, Show, type JSX } from "solid-js"
import { mediaUrl } from "~/lib/media"

/**
 * The optimised copies of the site's media in public/media (media-opt/encode.py and images.py next
 * to the checkout): AV1 and HEVC encodes of each product video, and AVIF and WebP stills, right-sized
 * for where they are drawn and content-hashed so they cache for a year. media-manifest.json lists only
 * copies that met the quality bar (VMAF ≥ 95 and SSIM ≥ 0.98 for video, SSIMULACRA2 ≥ 85 for
 * stills) against the original, which stays in place as the last fallback. Bundled at build time.
 * The Mobile orb loop's copies are the exception: every dot of its grid changes brightness in every
 * frame, so no copy much smaller than the original scores VMAF 95. Its 720-wide AV1 (147 kB) and HEVC
 * (336 kB) copies, against the 578 kB original, score SSIM 0.99 and were matched by eye at the
 * card's size.
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

// The 1080-wide card and 1200-wide clip files go to screens of 2.5 device pixels per CSS pixel or
// more (most phones); the 1280-wide hero files to phone-width windows.
const queries: Record<MediaKey, string> = {
  hi: "(min-resolution: 2.5dppx)",
  phone: "(max-width: 40rem)",
}

const base = (src: string) => `/media/${src.replace(/^\/(product-videos\/)?/, "").replace(/\.\w+$/, "")}`

export type VideoSource = { src: string; type?: string; media?: string }

/**
 * A video's sources in the order the browser should try them, all in the files bucket: the AV1
 * copies, the HEVC ones (Safari without an AV1 decoder), then the original H.264 file.
 */
export function videoSources(src: string): VideoSource[] {
  return [
    ...(manifest.video[src] ?? []).map(([width, codec, hash, level, key]) => ({
      src: mediaUrl(`${base(src)}.${width}.${codec}.${hash}.mp4`),
      type: `video/mp4; codecs="${codec === "av1" ? `av01.0.${String(level).padStart(2, "0")}M.08` : `hvc1.1.6.L${level}.B0`}"`,
      media: key ? queries[key] : undefined,
    })),
    { src: mediaUrl(src), type: "video/mp4" },
  ]
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

export { stillSizes } from "./still-sizes"

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

/**
 * Loads a video again once it is on the page. A client-rendered video gets its src while it still
 * belongs to Solid's template document, and while the router holds a new page off screen for its
 * data, Chromium tries the load there and rejects the URL ("URL safety check"). Joining the page
 * does not retry it. A video that has already picked its source is left alone.
 */
export function rescueMedia(video: HTMLVideoElement | undefined) {
  if (video && (video.getAttribute("src") || video.querySelector("source[src]")) && !video.currentSrc) video.load()
}

/** True when the user asks for reduced motion. Always false during SSR. */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * The page's colour scheme on the client: the site's theme (the site root's data-theme, which the
 * pre-paint script sets from the saved choice), else the system's. Server: undefined.
 */
export function pageScheme(): "light" | "dark" | undefined {
  if (typeof document === "undefined") return
  const theme = document.querySelector<HTMLElement>("[data-site]")?.dataset.theme
  if (theme === "light" || theme === "dark") return theme
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

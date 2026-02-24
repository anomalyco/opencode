import type { FileContent } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, Match, Show, Switch, type JSX } from "solid-js"
import {
  dataUrlFromMediaValue,
  hasMediaValue,
  isBinaryContent,
  mediaKindFromPath,
  normalizeMimeType,
  svgTextFromValue,
} from "../pierre/media"

export type FileMediaOptions = {
  mode?: "auto" | "off"
  path?: string
  current?: unknown
  before?: unknown
  after?: unknown
  readFile?: (path: string) => Promise<FileContent | undefined>
  renderImage?: (ctx: { src: string; path?: string; onLoad: () => void }) => JSX.Element
  renderAudio?: (ctx: { src: string; path?: string; mime?: string; onLoad: () => void }) => JSX.Element
  renderSvg?: (ctx: { src?: string; source: string; path?: string; onLoad: () => void }) => JSX.Element
  renderRemoved?: (ctx: { kind: "image" | "audio" }) => JSX.Element
  renderPlaceholder?: (ctx: { kind: "image" | "audio" }) => JSX.Element
  renderLoading?: (ctx: { kind: "image" | "audio" }) => JSX.Element
  renderError?: (ctx: { kind: "image" | "audio" | "svg" }) => JSX.Element
  renderBinaryPlaceholder?: (ctx: { path?: string }) => JSX.Element
  onLoad?: () => void
  onError?: (ctx: { kind: "image" | "audio" | "svg" }) => void
}

function defaultImage(ctx: { src: string; path?: string; onLoad: () => void }) {
  return (
    <div class="px-6 py-4">
      <img src={ctx.src} alt={ctx.path} class="max-w-full" onLoad={ctx.onLoad} />
    </div>
  )
}

function defaultAudio(ctx: { src: string; mime?: string; onLoad: () => void }) {
  return (
    <div class="px-6 py-4">
      <audio controls preload="metadata" onLoadedMetadata={ctx.onLoad}>
        <source src={ctx.src} type={ctx.mime} />
      </audio>
    </div>
  )
}

function defaultSvg(ctx: { src?: string; source: string; path?: string; onLoad: () => void }) {
  return (
    <div class="flex flex-col gap-4 px-6 py-4">
      <pre class="overflow-auto rounded border border-border-weak-base bg-background-base p-3 text-12-mono">
        {ctx.source}
      </pre>
      <Show when={ctx.src}>
        {(src) => (
          <div class="flex justify-center">
            <img src={src()} alt={ctx.path} class="max-w-full max-h-96" onLoad={ctx.onLoad} />
          </div>
        )}
      </Show>
    </div>
  )
}

function defaultBinary(path: string | undefined) {
  return <div class="px-6 py-4 text-text-weak">{path ? `${path} is binary.` : "Binary content"}</div>
}

function mediaValue(cfg: FileMediaOptions, mode: "image" | "audio") {
  if (cfg.current !== undefined) return cfg.current
  if (mode === "image") return cfg.after ?? cfg.before
  return cfg.after ?? cfg.before
}

export function FileMedia(props: { media?: FileMediaOptions; fallback: () => JSX.Element }) {
  const cfg = () => props.media
  const kind = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return
    return mediaKindFromPath(media.path)
  })

  const isBinary = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return false
    if (kind()) return false
    return isBinaryContent(media.current as any)
  })

  const [src, setSrc] = createSignal<string | undefined>(undefined)
  const [status, setStatus] = createSignal<"idle" | "loading" | "error">("idle")
  const [audioMime, setAudioMime] = createSignal<string | undefined>(undefined)
  let svgError = false

  const onLoad = () => props.media?.onLoad?.()

  const deleted = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || !k) return false
    if (k === "svg") return false
    if (media.current !== undefined) return false
    return !hasMediaValue(media.after as any) && hasMediaValue(media.before as any)
  })

  createEffect(() => {
    cfg()?.path
    cfg()?.current
    svgError = false
  })

  createEffect(() => {
    const media = cfg()
    const k = kind()
    if (!media || !k) {
      setSrc(undefined)
      setStatus("idle")
      setAudioMime(undefined)
      return
    }
    if (k === "svg") {
      setSrc(undefined)
      setStatus("idle")
      setAudioMime(undefined)
      return
    }

    setSrc(dataUrlFromMediaValue(mediaValue(media, k), k))
    setStatus("idle")
    setAudioMime(undefined)
  })

  createEffect(() => {
    const media = cfg()
    const k = kind()
    if (!media || !k || k === "svg") return
    if (media.current !== undefined) return
    if (src()) return
    if (status() !== "idle") return
    if (deleted()) return
    if (!media.path) return
    if (!media.readFile) return

    setStatus("loading")
    media
      .readFile(media.path)
      .then((result) => {
        const next = dataUrlFromMediaValue(result as any, k)
        if (!next) {
          setStatus("error")
          media.onError?.({ kind: k })
          return
        }

        setSrc(next)
        setStatus("idle")
        if (k === "audio") setAudioMime(normalizeMimeType(result?.mimeType))
      })
      .catch(() => {
        setStatus("error")
        media.onError?.({ kind: k })
      })
  })

  const svgSource = createMemo(() => {
    const media = cfg()
    if (!media) return
    return svgTextFromValue(media.current as any)
  })
  const svgSrc = createMemo(() => {
    const media = cfg()
    if (!media) return
    return dataUrlFromMediaValue(media.current as any, "svg")
  })

  createEffect(() => {
    if (kind() !== "svg") return
    const media = cfg()
    if (!media) return
    if (svgSource() !== undefined) return
    if (svgError) return
    if (!hasMediaValue(media.current as any)) return
    svgError = true
    media.onError?.({ kind: "svg" })
  })

  return (
    <Switch>
      <Match when={kind() === "image" || kind() === "audio"}>
        <Show
          when={src()}
          fallback={(() => {
            const media = cfg()
            const k = kind()
            if (!media || (k !== "image" && k !== "audio")) return props.fallback()
            if (deleted()) {
              return media.renderRemoved?.({ kind: k }) ?? <div class="px-6 py-4 text-text-weak">Removed {k} file.</div>
            }
            if (status() === "loading") {
              return media.renderLoading?.({ kind: k }) ?? <div class="px-6 py-4 text-text-weak">Loading {k}...</div>
            }
            if (status() === "error") {
              return media.renderError?.({ kind: k }) ?? <div class="px-6 py-4 text-text-weak">Unable to load {k}.</div>
            }
            return (
              media.renderPlaceholder?.({ kind: k }) ?? (
                <div class="px-6 py-4 text-text-weak">{k} preview unavailable.</div>
              )
            )
          })()}
        >
          {(value) => {
            const media = cfg()
            const k = kind()
            if (!media || (k !== "image" && k !== "audio")) return props.fallback()
            if (k === "image") {
              return (media.renderImage ?? defaultImage)({ src: value(), path: media.path, onLoad })
            }
            return (media.renderAudio ?? defaultAudio)({ src: value(), path: media.path, mime: audioMime(), onLoad })
          }}
        </Show>
      </Match>
      <Match when={kind() === "svg"}>
        {(() => {
          const media = cfg()
          if (!media) return props.fallback()
          if (!media.renderSvg && svgSource() === undefined && svgSrc() == null) return props.fallback()
          return (media.renderSvg ?? defaultSvg)({
            src: svgSrc(),
            source: svgSource() ?? "",
            path: media.path,
            onLoad,
          })
        })()}
      </Match>
      <Match when={isBinary()}>
        {cfg()?.renderBinaryPlaceholder?.({ path: cfg()?.path }) ?? defaultBinary(cfg()?.path)}
      </Match>
      <Match when={true}>{props.fallback()}</Match>
    </Switch>
  )
}

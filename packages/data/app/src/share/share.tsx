import "./share.css"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import {
  barTiming,
  drawShareCard,
  leaderColor,
  loadShareFonts,
  shareDuration,
  shareSizes,
  type ShareCard,
  type ShareOptions,
  type ShareTiming,
} from "./card"
import { cycleShareOption, designMode, designOnly, setShareOption, shareControls, shareOptions } from "./design"
import { shareTracks, type ShareTrack } from "./music"
import { loadSpectrum, type Spectrum } from "./spectrum"

export type ShareDraft = Omit<ShareCard, "updatedAt" | "url">

const [request, setRequest] = createSignal<ShareDraft>()
let opener: HTMLElement | undefined

/** The share icon in a section's heading. `card` reads the section's current view when it's pressed. */
export function ShareButton(props: { card: () => ShareDraft | undefined; label: string }) {
  return (
    <button
      type="button"
      data-component="share-button"
      aria-label={props.label}
      title={props.label}
      aria-haspopup="dialog"
      aria-expanded={request() !== undefined && request()?.id === props.card()?.id ? "true" : "false"}
      onClick={(event) => {
        const card = props.card()
        if (!card) return
        opener = event.currentTarget
        setRequest(card)
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11.5" cy="3.75" r="1.75" />
          <circle cx="4.5" cy="8" r="1.75" />
          <circle cx="11.5" cy="12.25" r="1.75" />
          <path d="m6.05 7.05 3.9-2.35M6.05 8.95l3.9 2.35" />
        </g>
      </svg>
      <span>Share</span>
    </button>
  )
}

const sizes = [
  { value: "4:5", label: "Feed" },
  { value: "1:1", label: "Square" },
  { value: "9:16", label: "Story" },
  { value: "16:9", label: "Wide" },
] as const

const layouts = [
  { value: "headline", label: "Headline" },
  { value: "number", label: "Number" },
  { value: "chart", label: "Title" },
] as const

/**
 * The share editor, mounted once on the page: the card in the middle, its options beside it (under it on phones, one
 * group at a time), and Copy link and Export in the top bar. Images and videos come from the same drawing code as
 * the preview (card.ts).
 */
export function ShareDialog(props: { updatedAt: string | null; url: string }) {
  let dialog: HTMLDialogElement | undefined
  let preview: HTMLCanvasElement | undefined
  let audio: HTMLAudioElement | undefined
  const [format, setFormat] = createSignal<"image" | "video">("video")
  const [notice, setNotice] = createSignal<string>()
  const [rendering, setRendering] = createSignal<number>()
  const [ready, setReady] = createSignal(false)
  const [playing, setPlaying] = createSignal(true)
  const [track, setTrack] = createSignal("none")
  const card = createMemo(() => {
    const value = request()
    if (!value) return undefined
    return { ...value, updatedAt: props.updatedAt, url: props.url }
  })
  // A copy of the options, so reading them tracks every field.
  const options = createMemo<ShareOptions>(() => ({ ...shareOptions }))
  const size = createMemo(() => shareSizes[options().size])
  const music = createMemo(() => shareTracks.find((item) => item.id === track()))
  // The chosen track's spectrum, for the dot equaliser; measured once per track (spectrum.ts). A plain signal, not a
  // resource: a resource would suspend the page's Suspense boundary, which takes the dialog out of the DOM and puts it
  // back no longer modal, under the page.
  const [spectrum, setSpectrum] = createSignal<Spectrum>()
  createEffect(() => {
    const url = music()?.url
    setSpectrum(undefined)
    if (!url) return
    let current = true
    onCleanup(() => (current = false))
    void loadSpectrum(url).then((value) => current && setSpectrum(value))
  })
  // With a soundtrack, the animation follows its bars and the video ends with it.
  const timing = createMemo(() => {
    const sound = music()
    return sound ? barTiming(sound.bar, sound.verse, sound.length, sound.beat, spectrum()) : undefined
  })
  let video: { key: string; file: Promise<File> } | undefined
  let closing: ReturnType<typeof setTimeout> | undefined

  // Load the card's font with the page, so the preview is ready the moment the editor opens.
  onMount(() => void loadShareFonts())

  createEffect(() => {
    const value = request()
    if (!value) return
    clearTimeout(closing)
    setNotice(undefined)
    setTrack("none")
    dialog?.showModal()
    void loadShareFonts().then(() => setReady(true))
  })

  // Notices clear themselves after a moment.
  createEffect(() => {
    if (!notice()) return
    const timer = setTimeout(() => setNotice(undefined), 2400)
    onCleanup(() => clearTimeout(timer))
  })

  // The preview's clock. Changing the layout, size or style redraws on the same clock, so the animation and its
  // music carry on; only a new card, track, type or play state starts it again.
  let clock = { key: "", start: 0, loop: -1 }

  // The preview: the still for an image; for a video, the animation on a loop with its soundtrack.
  createEffect(() => {
    const value = card()
    const opts = options()
    const sound = music()
    if (!value || !preview || !ready()) return
    const ctx = preview.getContext("2d")
    if (!ctx) return
    preview.width = size()[0]
    preview.height = size()[1]
    const still = format() === "image" || matchMedia("(prefers-reduced-motion: reduce)").matches
    if (still || !playing()) {
      audio?.pause()
      return drawShareCard(ctx, value, opts, Infinity, timing())
    }
    const length = shareDuration(value, opts, timing()) + 0.6
    const key = [value.id, sound?.id ?? "none", format(), playing()].join(" ")
    if (clock.key !== key) clock = { key, start: performance.now(), loop: -1 }
    const frame = () => {
      const elapsed = (performance.now() - clock.start) / 1000
      const turn = Math.floor(elapsed / length)
      if (turn !== clock.loop) {
        clock.loop = turn
        restartAudio(sound)
      }
      drawShareCard(ctx, value, opts, elapsed - turn * length, timing())
      handle = requestAnimationFrame(frame)
    }
    let handle = requestAnimationFrame(frame)
    onCleanup(() => cancelAnimationFrame(handle))
  })

  const restartAudio = (sound: ShareTrack | undefined) => {
    if (!sound) return audio?.pause()
    if (!audio || !audio.src.endsWith(sound.url)) {
      audio?.pause()
      audio = new Audio(sound.url)
    }
    audio.currentTime = 0
    // Browsers only play after a click; choosing a track or pressing play is one.
    void audio.play().catch(() => undefined)
  }

  const close = () => dialog?.close()

  const file = (kind: "image" | "video") => {
    const value = card()
    if (!value) return Promise.reject(new Error("Nothing to share"))
    if (kind === "image") return renderImage(value, options())
    const key = JSON.stringify([value, options(), track()])
    if (video?.key !== key) {
      setRendering(0)
      video = {
        key,
        file: renderVideo(value, options(), music(), timing(), setRendering).finally(() => setRendering(undefined)),
      }
    }
    return video.file
  }

  const run = async (action: () => Promise<string | undefined>) => {
    try {
      const message = await action()
      if (message) setNotice(message)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setNotice(error instanceof Error ? error.message : "Something went wrong")
    }
  }

  // Export saves the PNG or the video. On phones, where saving a file goes nowhere useful, it opens the share sheet.
  const exportFile = () =>
    run(async () => {
      const value = card()
      const shared = await file(format())
      if (!value) return
      const data = { files: [shared], title: value.title, text: `${value.headline} ${link(value)}` }
      if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.(data)) {
        await navigator.share(data)
        return undefined
      }
      download(shared)
      return format() === "image" ? "PNG saved" : "Video saved"
    })

  // Pressing the chosen track again plays or pauses it, with the preview.
  const chooseTrack = (id: string) => {
    if (id === track() && id !== "none") return setPlaying(!playing())
    setTrack(id)
    setPlaying(true)
  }

  return (
    <dialog
      ref={dialog}
      data-component="share-editor"
      aria-label="Share"
      // Escape closes it natively; a click on the backdrop lands on the dialog itself, since the editor fills its box.
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      onClose={() => {
        setPlaying(false)
        audio?.pause()
        opener?.focus()
        // Keep the editor drawn while it fades out.
        closing = setTimeout(() => {
          setRequest(undefined)
          setReady(false)
          setFormat("video")
        }, 160)
      }}
    >
      <Show when={card()}>
        {(value) => (
          <div data-slot="editor">
            <div data-slot="editor-stage">
              <button type="button" data-slot="icon-button" data-variant="close" aria-label="Close" onClick={close}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
              <Show when={designMode()}>
                <div data-component="share-design" aria-label="Design mode">
                  <For each={shareControls.filter((control) => designOnly.includes(control.key))}>
                    {(control) => {
                      const index = () => control.options.findIndex((option) => option[0] === options()[control.key])
                      return (
                        <div data-slot="control">
                          <button
                            type="button"
                            aria-label={`Previous ${control.label}`}
                            onClick={() => cycleShareOption(control.key, -1)}
                          >
                            ‹
                          </button>
                          <span data-slot="value">
                            <span data-slot="label">{control.label}</span>
                            {control.options[index()]?.[1]}
                            <span data-slot="count">
                              {index() + 1}/{control.options.length}
                            </span>
                          </span>
                          <button
                            type="button"
                            aria-label={`Next ${control.label}`}
                            onClick={() => cycleShareOption(control.key, 1)}
                          >
                            ›
                          </button>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <div data-slot="editor-canvas">
                <canvas
                  ref={preview}
                  data-slot="share-preview"
                  role="img"
                  aria-label={value().headline}
                  style={{ "aspect-ratio": `${size()[0]} / ${size()[1]}` }}
                />
                <Show when={rendering() !== undefined}>
                  <div data-slot="editor-rendering" role="status">
                    <span>Rendering video</span>
                    <i style={{ "--progress": `${(rendering() ?? 0) * 100}%` } as JSX.CSSProperties} />
                  </div>
                </Show>
              </div>
              <div data-slot="editor-toolbar">
                <span data-slot="editor-meta" role="status" aria-live="polite">
                  {notice() ?? `${size()[0]} × ${size()[1]}`}
                </span>
              </div>
            </div>

            <aside data-slot="editor-inspector" aria-label={`Share ${value().title}`}>
              <div data-slot="inspector-scroll">
                <div data-slot="rows">
                  <Row label="Type">
                    <For each={["video", "image"] as const}>
                      {(item) => (
                        <button
                          type="button"
                          data-slot="chip"
                          data-variant="text"
                          aria-pressed={format() === item}
                          onClick={() => {
                            setFormat(item)
                            setPlaying(true)
                          }}
                        >
                          <span>{item === "image" ? "Image" : "Video"}</span>
                        </button>
                      )}
                    </For>
                  </Row>
                  <Row label="Layout">
                    <For each={layouts}>
                      {(item) => (
                        <button
                          type="button"
                          data-slot="chip"
                          aria-label={item.label}
                          aria-pressed={options().layout === item.value}
                          onClick={() => setShareOption("layout", item.value)}
                        >
                          <LayoutGlyph layout={item.value} />
                          <small>{item.label}</small>
                        </button>
                      )}
                    </For>
                  </Row>
                  <Row label="Size">
                    <For each={sizes}>
                      {(item) => (
                        <button
                          type="button"
                          data-slot="chip"
                          aria-label={`${item.label} ${item.value}`}
                          data-tip={item.label}
                          aria-pressed={options().size === item.value}
                          onClick={() => setShareOption("size", item.value)}
                        >
                          <i data-slot="aspect" aria-hidden="true">
                            <b
                              style={{
                                width: `${aspectSide(item.value, 0)}px`,
                                height: `${aspectSide(item.value, 1)}px`,
                              }}
                            />
                          </i>
                          <small>{item.value}</small>
                        </button>
                      )}
                    </For>
                  </Row>
                  <Row label="Style">
                    <For each={["dark", "light", "leader"] as const}>
                      {(item) => (
                        <button
                          type="button"
                          data-slot="chip"
                          data-variant="wide"
                          aria-pressed={options().theme === item}
                          onClick={() => setShareOption("theme", item)}
                        >
                          <i
                            data-slot="swatch"
                            data-theme={item}
                            style={item === "leader" ? { background: leaderColor(value()) } : undefined}
                          />
                          <span>{{ dark: "Dark", light: "Light", leader: "Top" }[item]}</span>
                        </button>
                      )}
                    </For>
                  </Row>
                  <Show when={format() === "video"}>
                    <Row label="Music" variant="list">
                      <div data-slot="track-list" role="radiogroup" aria-label="Music">
                        <TrackOption
                          name="No music"
                          selected={track() === "none"}
                          onSelect={() => chooseTrack("none")}
                        />
                        <For each={shareTracks}>
                          {(item) => (
                            <TrackOption
                              name={item.name}
                              explicit={item.explicit}
                              cover={item.cover}
                              selected={track() === item.id}
                              playing={playing()}
                              onSelect={() => chooseTrack(item.id)}
                            />
                          )}
                        </For>
                      </div>
                    </Row>
                  </Show>
                </div>
              </div>
              <div data-slot="inspector-footer">
                <button
                  type="button"
                  data-slot="bar-button"
                  data-variant="primary"
                  disabled={rendering() !== undefined}
                  onClick={exportFile}
                >
                  {rendering() === undefined ? "Export" : "Rendering video…"}
                </button>
              </div>
            </aside>
          </div>
        )}
      </Show>
    </dialog>
  )
}

// One option row: its label on the left, its choices inline on the right.
function Row(props: { label: string; variant?: "list"; children: JSX.Element }) {
  return (
    <div data-slot="row" data-variant={props.variant} role="group" aria-label={props.label}>
      <span data-slot="row-label">{props.label}</span>
      <div data-slot="row-options">{props.children}</div>
    </div>
  )
}

function TrackOption(props: {
  name: string
  selected: boolean
  playing?: boolean
  explicit?: boolean
  cover?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      aria-label={
        props.selected && props.playing !== undefined
          ? `${props.name}, ${props.playing ? "playing. Press to pause" : "paused. Press to play"}`
          : undefined
      }
      data-slot="track"
      onClick={props.onSelect}
    >
      <i data-slot="track-icon" data-cover={props.cover ? "" : undefined} aria-hidden="true">
        <Show when={props.cover}>{(cover) => <img src={cover()} alt="" width="24" height="24" />}</Show>
        <Show
          when={props.selected && props.playing !== undefined}
          fallback={
            <Show when={!props.cover}>
              <svg width="16" height="16" viewBox="0 0 16 16">
                {/* No music: the familiar muted speaker. */}
                <path d="M2 6h2.75L8.5 3v10L4.75 10H2Z" fill="currentColor" />
                <path d="m10.5 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
              </svg>
            </Show>
          }
        >
          <Show
            when={props.playing}
            fallback={
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
              </svg>
            }
          >
            <span data-slot="eq">
              <b />
              <b />
              <b />
            </span>
          </Show>
        </Show>
      </i>
      <span>
        <strong>{props.name}</strong>
      </span>
      <Show when={props.explicit}>
        <em data-slot="explicit" title="Explicit lyrics">
          Explicit
        </em>
      </Show>
    </button>
  )
}

// The layout icons, centred: only what sits above the chart. Two headline lines, the big number as a block, or a single title
// line.
function LayoutGlyph(props: { layout: ShareOptions["layout"] }) {
  return (
    <svg data-slot="glyph" viewBox="0 0 40 28" aria-hidden="true">
      <Show when={props.layout === "headline"}>
        <rect x="4" y="9" width="32" height="3" fill="currentColor" />
        <rect x="9" y="16" width="22" height="3" fill="currentColor" />
      </Show>
      <Show when={props.layout === "number"}>
        <rect x="9" y="7" width="22" height="14" fill="currentColor" />
      </Show>
      <Show when={props.layout === "chart"}>
        <rect x="10" y="12.5" width="20" height="3" fill="currentColor" />
      </Show>
    </svg>
  )
}

function link(card: ShareCard) {
  return `https://${card.url}/#${card.id}`
}

function fileName(card: ShareCard, extension: string) {
  return `opencode-data-${card.id}-${new Date().toISOString().slice(0, 10)}.${extension}`
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function renderImage(card: ShareCard, options: ShareOptions) {
  await loadShareFonts()
  const canvas = document.createElement("canvas")
  const [width, height] = shareSizes[options.size]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is not available")
  drawShareCard(ctx, card, options, Infinity)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Could not make the image")
  return new File([blob], fileName(card, "png"), { type: "image/png" })
}

// Records the animation in real time from a canvas stream, with the soundtrack mixed in through Web Audio and faded
// out at the end. MP4 where the browser can record it (Safari, Chrome), WebM otherwise.
async function renderVideo(
  card: ShareCard,
  options: ShareOptions,
  track: ShareTrack | undefined,
  timing: ShareTiming | undefined,
  progress: (value: number) => void,
) {
  // Created before the first await, while the click still counts, so the context starts running.
  const context = track ? new AudioContext() : undefined
  await loadShareFonts()
  const types = track
    ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    : ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
  const type = types.find((item) => MediaRecorder.isTypeSupported(item))
  if (!type) throw new Error("This browser can't record video")
  const canvas = document.createElement("canvas")
  const [width, height] = shareSizes[options.size]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is not available")
  drawShareCard(ctx, card, options, 0, timing)
  const length = shareDuration(card, options, timing)
  const sound = context && track ? await soundtrack(context, track.url, length) : undefined
  const stream = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...(sound?.stream.getAudioTracks() ?? []),
  ])
  const recorder = new MediaRecorder(stream, {
    mimeType: type,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 192_000,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => chunks.push(event.data)
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))
  recorder.start()
  sound?.start()
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const frame = () => {
      const time = (performance.now() - start) / 1000
      drawShareCard(ctx, card, options, time, timing)
      progress(Math.min(1, time / length))
      if (time >= length) return resolve()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  recorder.stop()
  await done
  void context?.close()
  const base = type.split(";")[0] ?? "video/webm"
  return new File([new Blob(chunks, { type: base })], fileName(card, base === "video/mp4" ? "mp4" : "webm"), {
    type: base,
  })
}

async function soundtrack(context: AudioContext, url: string, length: number) {
  const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer())
  const destination = context.createMediaStreamDestination()
  const gain = context.createGain()
  gain.connect(destination)
  return {
    stream: destination.stream,
    start: () => {
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(gain)
      const now = context.currentTime
      gain.gain.setValueAtTime(1, now)
      // Tracks stop dead on their last word; the short ramp only keeps the cut from clicking.
      gain.gain.setValueAtTime(1, now + Math.max(0, length - 0.15))
      gain.gain.linearRampToValueAtTime(0, now + length)
      source.start(now)
      source.stop(now + length + 0.1)
    },
  }
}

// One side of a size's glyph: the longer side is 16px, the other in proportion, in an 18px square.
function aspectSide(size: ShareOptions["size"], side: 0 | 1) {
  const [width, height] = shareSizes[size]
  return Math.round((16 * (side === 0 ? width : height)) / Math.max(width, height))
}

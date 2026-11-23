import "./share.css"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { drawShareCard, loadShareFonts, shareDuration, shareSizes, type ShareCard, type ShareOptions } from "./card"
import { cycleShareOption, designMode, designOnly, setShareOption, shareControls, shareOptions } from "./design"
import { shareTracks, suggestedTrack, type ShareTrack } from "./music"

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
        <path
          d="M11.5 5.5a2 2 0 1 0-1.94-2.5L5.9 5.1a2 2 0 1 0 0 2.8l3.66 2.1a2 2 0 1 0 .74-1.3L6.64 6.6a2 2 0 0 0 0-1.2L10.3 3.3c.33.13.76.2 1.2.2Z"
          fill="currentColor"
        />
      </svg>
      <span>Share</span>
    </button>
  )
}

type Tab = "layout" | "size" | "style" | "video"

const sizes = [
  { value: "4:5", label: "Feed", hint: "X, LinkedIn, Instagram" },
  { value: "1:1", label: "Square", hint: "Any feed" },
  { value: "9:16", label: "Story", hint: "Stories, Reels" },
  { value: "16:9", label: "Wide", hint: "Slides, YouTube" },
] as const

const layouts = [
  { value: "headline", label: "Headline" },
  { value: "number", label: "Big number" },
  { value: "chart", label: "Chart" },
] as const

/**
 * The share editor, mounted once on the page: the card in the middle, its options beside it (under it on phones, one
 * group at a time), and Copy link and Export in the top bar. Images and videos come from the same drawing code as
 * the preview (card.ts).
 */
export function ShareDialog(props: { updatedAt: string | null; url: string }) {
  let dialog: HTMLDialogElement | undefined
  let preview: HTMLCanvasElement | undefined
  let exportButton: HTMLButtonElement | undefined
  let audio: HTMLAudioElement | undefined
  const [format, setFormat] = createSignal<"image" | "video">("image")
  const [notice, setNotice] = createSignal<string>()
  const [rendering, setRendering] = createSignal<number>()
  const [ready, setReady] = createSignal(false)
  const [playing, setPlaying] = createSignal(true)
  const [track, setTrack] = createSignal("none")
  const [menu, setMenu] = createSignal(false)
  const [tab, setTab] = createSignal<Tab>("layout")
  const card = createMemo(() => {
    const value = request()
    if (!value) return undefined
    return { ...value, updatedAt: props.updatedAt, url: props.url }
  })
  // A copy of the options, so reading them tracks every field.
  const options = createMemo<ShareOptions>(() => ({ ...shareOptions }))
  const size = createMemo(() => shareSizes[options().size])
  const music = createMemo(() => shareTracks.find((item) => item.id === track()))
  const canShareFiles = () =>
    typeof navigator !== "undefined" &&
    !!navigator.canShare?.({ files: [new File([], "card.png", { type: "image/png" })] })
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
    setTab("layout")
    dialog?.showModal()
    void loadShareFonts().then(() => setReady(true))
  })

  // Notices clear themselves after a moment.
  createEffect(() => {
    if (!notice()) return
    const timer = setTimeout(() => setNotice(undefined), 2400)
    onCleanup(() => clearTimeout(timer))
  })

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
      return drawShareCard(ctx, value, opts, Infinity)
    }
    const length = shareDuration(value, opts) + 0.6
    const start = performance.now()
    let loop = -1
    const frame = () => {
      const elapsed = (performance.now() - start) / 1000
      const turn = Math.floor(elapsed / length)
      if (turn !== loop) {
        loop = turn
        restartAudio(sound)
      }
      drawShareCard(ctx, value, opts, elapsed - turn * length)
      handle = requestAnimationFrame(frame)
    }
    let handle = requestAnimationFrame(frame)
    onCleanup(() => {
      cancelAnimationFrame(handle)
      audio?.pause()
    })
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
        file: renderVideo(value, options(), music(), setRendering).finally(() => setRendering(undefined)),
      }
    }
    return video.file
  }

  const run = async (action: () => Promise<string | undefined>) => {
    setMenu(false)
    try {
      const message = await action()
      if (message) setNotice(message)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setNotice(error instanceof Error ? error.message : "Something went wrong")
    }
  }

  const share = () =>
    run(async () => {
      const value = card()
      const shared = await file(format())
      if (!value) return
      const data = { files: [shared], title: value.title, text: `${value.headline} ${link(value)}` }
      if (navigator.canShare?.(data)) {
        await navigator.share(data)
        return undefined
      }
      download(shared)
      return "Saved. Attach it to your post."
    })

  const copyImage = () =>
    run(async () => {
      const value = card()
      if (!value) return
      // Safari needs the clipboard write to start in the click, with the image as a promise.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": renderImage(value, options()) })])
      return "Image copied"
    })

  const save = (kind: "image" | "video") =>
    run(async () => {
      download(await file(kind))
      return kind === "image" ? "PNG saved" : "Video saved"
    })

  const copyLink = () =>
    run(async () => {
      const value = card()
      if (!value) return
      await navigator.clipboard.writeText(link(value))
      return "Link copied"
    })

  const post = () =>
    run(async () => {
      const value = card()
      if (!value) return
      window.open(
        `https://x.com/intent/post?text=${encodeURIComponent(value.headline)}&url=${encodeURIComponent(link(value))}`,
        "_blank",
        "noopener",
      )
      return undefined
    })

  // Pressing the chosen track again plays or pauses it, with the preview.
  const chooseTrack = (id: string) => {
    if (id === track() && id !== "none") return setPlaying(!playing())
    setTrack(id)
    setPlaying(true)
  }

  const tabs = createMemo(() =>
    (
      [
        ["layout", "Layout"],
        ["size", "Size"],
        ["style", "Style"],
        ["video", "Motion"],
      ] as const
    ).filter((item) => item[0] !== "video" || format() === "video"),
  )

  createEffect(() => {
    if (format() === "image" && tab() === "video") setTab("layout")
  })

  return (
    <dialog
      ref={dialog}
      data-component="share-editor"
      aria-label="Share"
      onCancel={(event) => {
        if (!menu()) return
        event.preventDefault()
        setMenu(false)
        exportButton?.focus()
      }}
      onClose={() => {
        setMenu(false)
        setPlaying(false)
        audio?.pause()
        opener?.focus()
        // Keep the editor drawn while it fades out.
        closing = setTimeout(() => {
          setRequest(undefined)
          setReady(false)
          setFormat("image")
        }, 160)
      }}
      onClick={(event) => {
        if (menu() && !(event.target as HTMLElement).closest('[data-slot="export"]')) setMenu(false)
      }}
    >
      <Show when={card()}>
        {(value) => (
          <div data-slot="editor">
            <header data-slot="editor-bar">
              <button type="button" data-slot="icon-button" aria-label="Close" onClick={close}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
              <div data-slot="editor-title">
                <strong>Share</strong>
                <span>{value().title}</span>
              </div>
              <div data-slot="editor-actions">
                <button type="button" data-slot="bar-button" onClick={copyLink}>
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"
                      stroke="currentColor"
                      stroke-width="1.5"
                      fill="none"
                    />
                  </svg>
                  <span>Copy link</span>
                </button>
                <div data-slot="export">
                  <button
                    ref={exportButton}
                    type="button"
                    data-slot="bar-button"
                    data-variant="primary"
                    aria-haspopup="menu"
                    aria-expanded={menu() ? "true" : "false"}
                    disabled={rendering() !== undefined}
                    onClick={() => setMenu(!menu())}
                  >
                    <span>Export</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path d="m3 4.5 3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" />
                    </svg>
                  </button>
                  <Show when={menu()}>
                    <div data-slot="export-menu" role="menu" aria-label="Export">
                      <Show when={canShareFiles()}>
                        <MenuItem label={`Share ${format()}`} hint="Send to an app" onClick={share} />
                      </Show>
                      <Show when={format() === "image"}>
                        <MenuItem label="Copy image" hint="Paste into a post" onClick={copyImage} />
                        <MenuItem
                          label="Download PNG"
                          hint={`${size()[0]} × ${size()[1]}`}
                          onClick={() => save("image")}
                        />
                      </Show>
                      <Show when={format() === "video"}>
                        <MenuItem
                          label="Download video"
                          hint={`${Math.round(shareDuration(value(), options()))}s${music() ? `, ${music()?.name}` : ", no music"}`}
                          onClick={() => save("video")}
                        />
                        <MenuItem label="Download still" hint="The last frame, as PNG" onClick={() => save("image")} />
                      </Show>
                      <MenuItem label="Post on X" hint="Opens a draft with the link" onClick={post} />
                    </div>
                  </Show>
                </div>
              </div>
            </header>

            <div data-slot="editor-stage">
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
                <div data-slot="segmented" role="group" aria-label="Format">
                  <For each={["image", "video"] as const}>
                    {(item) => (
                      <button
                        type="button"
                        aria-pressed={format() === item}
                        onClick={() => {
                          setFormat(item)
                          setPlaying(true)
                        }}
                      >
                        {item === "image" ? "Image" : "Video"}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={format() === "video"}>
                  <button
                    type="button"
                    data-slot="icon-button"
                    aria-label={playing() ? "Pause preview" : "Play preview"}
                    onClick={() => setPlaying(!playing())}
                  >
                    <Show
                      when={playing()}
                      fallback={
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
                        </svg>
                      }
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" fill="currentColor" />
                      </svg>
                    </Show>
                  </button>
                </Show>
                <span data-slot="editor-meta" role="status" aria-live="polite">
                  {notice() ??
                    `${size()[0]} × ${size()[1]}${format() === "video" ? ` · ${Math.round(shareDuration(value(), options()))}s · ${music()?.name ?? "No music"}` : ""}`}
                </span>
              </div>
            </div>

            <aside data-slot="editor-inspector" aria-label="Options">
              <div data-slot="editor-tabs" role="tablist" aria-label="Options">
                <For each={tabs()}>
                  {(item) => (
                    <button type="button" role="tab" aria-selected={tab() === item[0]} onClick={() => setTab(item[0])}>
                      {item[1]}
                    </button>
                  )}
                </For>
              </div>

              <Group id="layout" title="Layout" active={tab()}>
                <div data-slot="option-grid" data-columns="3">
                  <For each={layouts}>
                    {(item) => (
                      <button
                        type="button"
                        data-slot="option"
                        aria-pressed={options().layout === item.value}
                        onClick={() => setShareOption("layout", item.value)}
                      >
                        <LayoutGlyph layout={item.value} />
                        <span>{item.label}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Group>

              <Group id="size" title="Size" active={tab()}>
                <div data-slot="option-grid" data-columns="2">
                  <For each={sizes}>
                    {(item) => (
                      <button
                        type="button"
                        data-slot="option"
                        data-variant="row"
                        aria-pressed={options().size === item.value}
                        onClick={() => setShareOption("size", item.value)}
                      >
                        <i
                          data-slot="aspect"
                          style={{
                            "aspect-ratio": `${shareSizes[item.value][0]} / ${shareSizes[item.value][1]}`,
                          }}
                        />
                        <span>
                          <strong>
                            {item.label} <em>{item.value}</em>
                          </strong>
                          <small>{item.hint}</small>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Group>

              <Group id="style" title="Style" active={tab()}>
                <div data-slot="option-grid" data-columns="2">
                  <For each={["dark", "light"] as const}>
                    {(item) => (
                      <button
                        type="button"
                        data-slot="option"
                        data-variant="row"
                        aria-pressed={options().theme === item}
                        onClick={() => setShareOption("theme", item)}
                      >
                        <i data-slot="swatch" data-theme={item} />
                        <span>
                          <strong>{item === "dark" ? "Dark" : "Light"}</strong>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Group>

              <Show when={format() === "video"}>
                <Group id="video" title="Motion" active={tab()}>
                  <div data-slot="segmented" data-variant="full" role="group" aria-label="Motion">
                    <button
                      type="button"
                      aria-pressed={options().motion === "highlight"}
                      onClick={() => setShareOption("motion", "highlight")}
                    >
                      Highlight each
                    </button>
                    <button
                      type="button"
                      aria-pressed={options().motion === "build"}
                      onClick={() => setShareOption("motion", "build")}
                    >
                      Build only
                    </button>
                  </div>
                  <div data-slot="group-title">
                    <h3>Music</h3>
                  </div>
                  <div data-slot="track-list" role="radiogroup" aria-label="Music">
                    <TrackOption
                      name="No music"
                      detail="Silent, as feeds autoplay"
                      selected={track() === "none"}
                      onSelect={() => chooseTrack("none")}
                    />
                    <For each={shareTracks}>
                      {(item) => (
                        <TrackOption
                          name={item.name}
                          detail={`${item.mood} · ${item.bpm} BPM`}
                          suggested={suggestedTrack[value().id] === item.id}
                          selected={track() === item.id}
                          playing={playing()}
                          onSelect={() => chooseTrack(item.id)}
                        />
                      )}
                    </For>
                  </div>
                </Group>
              </Show>
            </aside>
          </div>
        )}
      </Show>
    </dialog>
  )
}

function Group(props: { id: Tab; title: string; active: Tab; children: JSX.Element }) {
  return (
    <section data-slot="group" data-active={props.active === props.id ? "true" : undefined} role="tabpanel">
      <div data-slot="group-title">
        <h3>{props.title}</h3>
      </div>
      {props.children}
    </section>
  )
}

function MenuItem(props: { label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={props.onClick}>
      <strong>{props.label}</strong>
      <span>{props.hint}</span>
    </button>
  )
}

function TrackOption(props: {
  name: string
  detail: string
  selected: boolean
  playing?: boolean
  suggested?: boolean
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
      <i data-slot="track-icon" aria-hidden="true">
        <Show
          when={props.selected && props.playing !== undefined}
          fallback={
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M6 3.5v6.6a2 2 0 1 0 1.5 1.9V6h4V3.5H6Z" fill="currentColor" />
            </svg>
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
        <strong>
          {props.name}
          <Show when={props.suggested}>
            <em>Suggested</em>
          </Show>
        </strong>
        <small>{props.detail}</small>
      </span>
    </button>
  )
}

function LayoutGlyph(props: { layout: ShareOptions["layout"] }) {
  return (
    <svg data-slot="glyph" viewBox="0 0 40 50" aria-hidden="true">
      <rect x="4" y="4" width="8" height="3" fill="currentColor" />
      <Show when={props.layout === "headline"}>
        <rect x="4" y="12" width="30" height="3" fill="currentColor" />
        <rect x="4" y="17" width="22" height="3" fill="currentColor" />
      </Show>
      <Show when={props.layout === "number"}>
        <rect x="4" y="11" width="18" height="9" fill="currentColor" />
      </Show>
      <Show when={props.layout === "chart"}>
        <rect x="4" y="12" width="16" height="4" fill="currentColor" />
      </Show>
      <rect
        x="4"
        y={props.layout === "chart" ? 30 : 34}
        width="4"
        height={props.layout === "chart" ? 14 : 10}
        opacity="0.5"
        fill="currentColor"
      />
      <rect
        x="10"
        y={props.layout === "chart" ? 26 : 31}
        width="4"
        height={props.layout === "chart" ? 18 : 13}
        opacity="0.5"
        fill="currentColor"
      />
      <rect
        x="16"
        y={props.layout === "chart" ? 28 : 33}
        width="4"
        height={props.layout === "chart" ? 16 : 11}
        opacity="0.5"
        fill="currentColor"
      />
      <rect
        x="22"
        y={props.layout === "chart" ? 22 : 29}
        width="4"
        height={props.layout === "chart" ? 22 : 15}
        opacity="0.5"
        fill="currentColor"
      />
      <rect
        x="28"
        y={props.layout === "chart" ? 24 : 30}
        width="4"
        height={props.layout === "chart" ? 20 : 14}
        opacity="0.5"
        fill="currentColor"
      />
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
  drawShareCard(ctx, card, options, 0)
  const length = shareDuration(card, options)
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
      drawShareCard(ctx, card, options, time)
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
      gain.gain.setValueAtTime(1, now + Math.max(0, length - 0.8))
      gain.gain.linearRampToValueAtTime(0, now + length)
      source.start(now)
      source.stop(now + length + 0.1)
    },
  }
}

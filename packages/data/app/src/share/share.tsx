import "./share.css"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import {
  barTiming,
  drawShareCard,
  mainLength,
  leaderColor,
  loadShareFonts,
  shareDuration,
  shareSizes,
  type ShareCard,
  type ShareOptions,
  type ShareTiming,
} from "./card"
import { embedSnippet, embedUrl, packCard } from "./embed"
import { dataFlag } from "../lib/flag"
import { cardLogos, loadShareLogos } from "./logos"
import { cycleShareOption, designMode, designOnly, setShareOption, shareControls, shareOptions } from "./design"
import { shareTracks, type ShareTrack } from "./music"
import type { ShareView } from "./embed"
import { loadSpectrum, type Spectrum } from "./spectrum"
import { ShareCalendar, shareDayLabel, shareRangeLabel } from "./calendar"

// `view` is the range the section showed, so an embed of it can show the same. `variant` makes the card again for a
// focus, for the editor's Date and Lead rows (share/sections.ts).
export type ShareDraft = Omit<ShareCard, "updatedAt" | "url"> & {
  view?: ShareView
  variant?: (focus: ShareFocus) => ShareDraft | undefined
}

/** One column of a bar chart (`day`) instead of the whole range, and whether to lead with the top series or the total. */
export type ShareFocus = { day?: number; lead?: "top" | "total" }

const [request, setRequest] = createSignal<ShareDraft>()
let opener: HTMLElement | undefined
// Every share button on the page, so the editor's arrows can step from one section to the next.
const sections = new Set<{ element: HTMLElement; card: () => ShareDraft | undefined }>()

// The next section along in page order, wrapping round at either end, skipping any with nothing to share yet.
function step(direction: 1 | -1) {
  const order = [...sections]
    .filter((item) => item.element.isConnected)
    .toSorted((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  const current = order.findIndex((item) => item.element === opener)
  const next = order
    .map((_, offset) => order[(current + direction * (offset + 1) + order.length * 2) % order.length]!)
    .find((item) => item.card())
  if (!next) return
  opener = next.element
  setRequest(next.card())
}

/** The share icon in a section's heading. `card` reads the section's current view when it's pressed. */
export function ShareButton(props: { card: () => ShareDraft | undefined; label: string }) {
  if (!dataFlag("share")) return null
  let element: HTMLButtonElement | undefined
  onMount(() => {
    if (!element) return
    const entry = { element, card: () => props.card() }
    sections.add(entry)
    onCleanup(() => sections.delete(entry))
  })
  return (
    <button
      ref={element}
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
  const [format, setFormat] = createSignal<"image" | "video" | "embed">("video")
  // An embed shows the latest data by default; a fixed one keeps today's numbers (share/embed.ts).
  const [fixed, setFixed] = createSignal(false)
  const [snippet, setSnippet] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  const [notice, setNotice] = createSignal<string>()
  const [rendering, setRendering] = createSignal<number>()
  const [ready, setReady] = createSignal(false)
  const [playing, setPlaying] = createSignal(true)
  const [track, setTrack] = createSignal("none")
  // The open dropdown or the date picker, by id; one at a time.
  const [menu, setMenu] = createSignal<string>()
  // The chart column the card is about, or the whole range; each section starts on the whole range.
  const [day, setDay] = createSignal<number>()
  // Lead with the top model or the total: the sections that can say a total (Top Models).
  const [lead, setLead] = createSignal<"top" | "total">("top")
  const section = createMemo(() => request()?.id)
  createEffect(() => {
    section()
    setDay(undefined)
    setLead("top")
  })
  const leads = createMemo(() => request()?.id === "top-models" && !!request()?.variant)
  // The first days of the columns the date picker can choose from: a bar chart's, when its section can make a card
  // for one.
  const starts = createMemo(() => {
    const value = request()
    if (!value?.variant || value.chart.kind !== "stacked") return []
    const dates = value.chart.columns.map((column) => column.start ?? "")
    return dates.every(Boolean) ? dates : []
  })
  const weekly = () => request()?.view?.period === "weekly"
  const dateLabel = () => {
    const index = day()
    return index === undefined ? shareRangeLabel(starts(), weekly()) : shareDayLabel(starts()[index] ?? "", weekly())
  }
  // The arrow keys step through the music, from either arrow button.
  const musicKeys = (event: KeyboardEvent) => {
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || menu() === "music") return
    event.preventDefault()
    chooseTrack(stepTrack(track(), event.key === "ArrowLeft" ? -1 : 1))
  }
  const card = createMemo(() => {
    const value = request()
    if (!value) return undefined
    const focus = { day: day(), lead: lead() }
    const chosen = focus.day === undefined && focus.lead === "top" ? value : (value.variant?.(focus) ?? value)
    return { ...chosen, variant: undefined, updatedAt: props.updatedAt, url: props.url }
  })
  // The card's provider logos (the leaderboard and comparison cards); the preview redraws once they've loaded.
  const [logos, setLogos] = createSignal(0)
  createEffect(() => {
    const value = card()
    if (!value) return
    const ids = cardLogos(value.chart)
    if (ids.length > 0) void loadShareLogos(ids).then(() => setLogos((count) => count + 1))
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
  // The code to paste for an embed, rebuilt as its options change; a fixed one packs the card into its fragment.
  createEffect(() => {
    const value = card()
    const opts = options()
    if (format() !== "embed" || !value) return
    const url = embedUrl(new URL(import.meta.env.BASE_URL, location.origin).toString(), value, opts)
    const done = (address: URL) => setSnippet(embedSnippet(address.toString(), value.title, opts.size))
    if (!fixed()) return done(url)
    let current = true
    onCleanup(() => (current = false))
    void packCard(value).then((packed) => {
      if (!current) return
      url.hash = `card=${packed}`
      done(url)
    })
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
    // Stepping to another section keeps the editor open, its music and its options.
    if (dialog?.open) return
    setFormat("video")
    setMenu(undefined)
    shuffle()
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
    logos()
    if (!value || !preview || !ready()) return
    const ctx = preview.getContext("2d")
    if (!ctx) return
    preview.width = size()[0]
    preview.height = size()[1]
    const still = format() === "image" || matchMedia("(prefers-reduced-motion: reduce)").matches
    if (still || !playing()) {
      audio?.pause()
      // So playing again starts the animation and its track over; the clock would otherwise look unchanged.
      clock.key = ""
      return drawShareCard(ctx, value, opts, Infinity, timing())
    }
    // An embed plays its card once, silently, and rests on it, as it will on the host page.
    if (format() === "embed") {
      audio?.pause()
      const start = performance.now()
      const length = mainLength(value, opts)
      const tick = () => {
        const time = (performance.now() - start) / 1000
        drawShareCard(ctx, value, opts, time >= length ? Infinity : time)
        if (time < length) handle = requestAnimationFrame(tick)
      }
      let handle = requestAnimationFrame(tick)
      onCleanup(() => cancelAnimationFrame(handle))
      return
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

  // A card made at random: any layout and style, a size for a feed or a story (not Wide), and a track, never silence.
  // Playing from the start again, as each opening does.
  const shuffle = () => {
    setShareOption("layout", pick(layouts).value)
    setShareOption("size", pick(sizes.filter((item) => item.value !== "16:9")).value)
    setShareOption("theme", pick(["dark", "light", "leader"] as const))
    setTrack(pick(shareTracks).id)
    setPlaying(true)
  }

  const file = async (kind: "image" | "video") => {
    const value = card()
    if (!value) throw new Error("Nothing to share")
    await loadShareLogos(cardLogos(value.chart))
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
      const kind = format()
      // The button says Copied for a moment instead of a notice.
      if (kind === "embed") {
        await navigator.clipboard.writeText(snippet())
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
        return undefined
      }
      const value = card()
      const shared = await file(kind)
      if (!value) return
      const data = { files: [shared], title: value.title, text: `${value.headline} ${link(value)}` }
      if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.(data)) {
        await navigator.share(data)
        return undefined
      }
      download(shared)
      return kind === "image" ? "PNG saved" : "Video saved"
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
      // Escape closes an open dropdown first, then the editor.
      onCancel={(event) => {
        if (!menu()) return
        event.preventDefault()
        setMenu(undefined)
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
            {/* The bar across the top, like an editor's: Close and Shuffle, every option as a dropdown, the music with
                arrows either side, and Export on the right. */}
            <div data-slot="editor-bar" role="toolbar" aria-label={`Share ${value().title}`}>
              <button type="button" data-slot="icon-button" aria-label="Close" onClick={close}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
              <button type="button" data-slot="icon-button" aria-label="Shuffle" title="Shuffle" onClick={shuffle}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <g fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M2 4.5h2.5c3.5 0 3.5 7 7 7H14M2 11.5h2.5c1.4 0 2.2-1.1 2.9-2.4M14 4.5h-2.5c-1.4 0-2.2 1.1-2.9 2.4" />
                    <path d="m12 2.5 2 2-2 2M12 9.5l2 2-2 2" />
                  </g>
                </svg>
              </button>
              <span data-slot="bar-divider" aria-hidden="true" />
              <Dropdown
                id="type"
                label="Type"
                open={menu()}
                onOpen={setMenu}
                value={format()}
                options={(["video", "image", "embed"] as const).map((item) => ({
                  value: item,
                  label: { video: "Video", image: "Image", embed: "Embed" }[item],
                  icon: <TypeGlyph format={item} />,
                }))}
                onSelect={(item) => {
                  setFormat(item)
                  setPlaying(true)
                }}
              />
              <Show when={starts().length > 1}>
                <div data-slot="date-tool">
                  <button
                    type="button"
                    data-slot="dropdown-trigger"
                    aria-label={`Date: ${dateLabel()}`}
                    aria-haspopup="dialog"
                    aria-expanded={menu() === "date" ? "true" : "false"}
                    onClick={() => setMenu(menu() === "date" ? undefined : "date")}
                  >
                    <span data-slot="tool-icon">
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M2.75 3.75h10.5v9.5H2.75zM2.75 6.75h10.5M5.5 2v3M10.5 2v3"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                        />
                      </svg>
                    </span>
                    <span data-slot="dropdown-value">{dateLabel()}</span>
                    <Chevron />
                  </button>
                  <Show when={menu() === "date"}>
                    <ShareCalendar
                      starts={starts()}
                      weekly={weekly()}
                      day={day()}
                      onPick={setDay}
                      onClose={() => setMenu(undefined)}
                    />
                  </Show>
                </div>
              </Show>
              <Show when={leads()}>
                <Dropdown
                  id="lead"
                  label="Lead with"
                  open={menu()}
                  onOpen={setMenu}
                  value={lead()}
                  options={[
                    { value: "top" as const, label: "Top model", icon: <LeadGlyph lead="top" /> },
                    { value: "total" as const, label: "Total", icon: <LeadGlyph lead="total" /> },
                  ]}
                  onSelect={setLead}
                />
              </Show>
              <Dropdown
                id="layout"
                label="Layout"
                open={menu()}
                onOpen={setMenu}
                value={options().layout}
                options={layouts.map((item) => ({
                  value: item.value,
                  label: item.label,
                  icon: <LayoutGlyph layout={item.value} />,
                }))}
                onSelect={(item) => setShareOption("layout", item)}
              />
              <Dropdown
                id="size"
                label="Size"
                open={menu()}
                onOpen={setMenu}
                value={options().size}
                show="value"
                options={sizes.map((item) => ({ value: item.value, label: item.value, detail: item.label }))}
                onSelect={(item) => setShareOption("size", item)}
              />
              <Dropdown
                id="style"
                label="Style"
                open={menu()}
                onOpen={setMenu}
                value={options().theme}
                options={(["dark", "light", "leader"] as const).map((item) => ({
                  value: item,
                  label: { dark: "Dark", light: "Light", leader: "Top" }[item],
                  icon: (
                    <i
                      data-slot="swatch"
                      data-theme={item}
                      style={item === "leader" ? { background: leaderColor(value()) } : undefined}
                    />
                  ),
                }))}
                onSelect={(item) => setShareOption("theme", item)}
              />
              <Show when={format() === "embed"}>
                <Dropdown
                  id="data"
                  label="Data"
                  open={menu()}
                  onOpen={setMenu}
                  value={fixed() ? "fixed" : "live"}
                  options={[
                    { value: "live" as const, label: "Live data", detail: "Always the latest" },
                    { value: "fixed" as const, label: "Fixed data", detail: "Today's numbers" },
                  ]}
                  onSelect={(item) => setFixed(item === "fixed")}
                />
              </Show>
              <Show when={format() === "video"}>
                <span data-slot="bar-divider" aria-hidden="true" />
                <div data-slot="music-tool" role="group" aria-label="Music" onKeyDown={musicKeys}>
                  <button
                    type="button"
                    data-slot="icon-button"
                    aria-label="Previous track"
                    onClick={() => chooseTrack(stepTrack(track(), -1))}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
                    </svg>
                  </button>
                  <Dropdown
                    id="music"
                    label="Music"
                    open={menu()}
                    onOpen={setMenu}
                    value={track()}
                    options={[
                      { value: "none", label: "No music", icon: <MusicCover /> },
                      ...shareTracks.map((item) => ({
                        value: item.id,
                        label: item.name,
                        explicit: item.explicit,
                        icon: <MusicCover cover={item.cover} />,
                      })),
                    ]}
                    show="both"
                    trigger={
                      <MusicCover
                        cover={music()?.cover}
                        state={music() ? (playing() ? "playing" : "paused") : undefined}
                      />
                    }
                    onSelect={chooseTrack}
                  />
                  <button
                    type="button"
                    data-slot="icon-button"
                    aria-label="Next track"
                    onClick={() => chooseTrack(stepTrack(track(), 1))}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
                    </svg>
                  </button>
                </div>
              </Show>
              <button
                type="button"
                data-slot="bar-button"
                data-variant="primary"
                data-rendering={rendering() !== undefined ? "" : undefined}
                // While a video renders, the button is its progress bar: it fills from the left as the frames go.
                style={{ "--progress": `${(rendering() ?? 0) * 100}%` } as JSX.CSSProperties}
                disabled={rendering() !== undefined}
                aria-live="polite"
                aria-label={{ image: "Export image", video: "Export video", embed: "Copy embed code" }[format()]}
                onClick={exportFile}
              >
                <Show when={rendering() !== undefined ? "rendering" : copied() ? "copied" : "export"} keyed>
                  <span data-slot="button-label">
                    {rendering() !== undefined
                      ? `${Math.round((rendering() ?? 0) * 100)}%`
                      : copied()
                        ? "Copied"
                        : "Export"}
                  </span>
                </Show>
              </button>
            </div>

            <div data-slot="editor-stage" data-card-theme={options().theme}>
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
              <button
                type="button"
                data-slot="icon-button"
                data-variant="step"
                data-side="previous"
                aria-label="Previous section"
                onClick={() => step(-1)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
              <button
                type="button"
                data-slot="icon-button"
                data-variant="step"
                data-side="next"
                aria-label="Next section"
                onClick={() => step(1)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
              <div data-slot="editor-canvas">
                <canvas
                  ref={preview}
                  data-slot="share-preview"
                  role="img"
                  aria-label={value().headline}
                  style={{ "aspect-ratio": `${size()[0]} / ${size()[1]}` }}
                />
              </div>
              {/* Saved and copied notices, for a moment, on a line kept for them so the card never shifts. */}
              <div data-slot="editor-toolbar">
                <span data-slot="editor-meta" role="status" aria-live="polite">
                  {notice()}
                </span>
              </div>
            </div>
          </div>
        )}
      </Show>
    </dialog>
  )
}

function pick<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]!
}

// A dropdown in the bar, a fixed width: by `show`, its icon alone, its value alone, or both (the music: the cover, from
// `trigger`, and the name); then a chevron. The choices open in a list under it, each with its icon and name. Arrow keys move through the list, Enter or a click chooses, Escape or a press elsewhere closes it.
function Dropdown<T extends string>(props: {
  id: string
  label: string
  open: string | undefined
  onOpen: (id: string | undefined) => void
  value: T
  options: { value: T; label: string; detail?: string; explicit?: boolean; icon?: JSX.Element }[]
  show?: "icon" | "value" | "both"
  trigger?: JSX.Element
  onSelect: (value: T) => void
}) {
  const show = () => props.show ?? "icon"
  let element: HTMLDivElement | undefined
  const open = () => props.open === props.id
  const current = () => props.options.find((item) => item.value === props.value)
  const close = (focus: boolean) => {
    props.onOpen(undefined)
    if (focus) element?.querySelector<HTMLElement>("[data-slot=dropdown-trigger]")?.focus()
  }
  // Opening focuses the chosen item, so the arrow keys start from it.
  createEffect(() => {
    if (!open()) return
    requestAnimationFrame(() => element?.querySelector<HTMLElement>("[role=option][aria-selected=true]")?.focus())
    const away = (event: PointerEvent) => {
      if (element && !element.contains(event.target as Node)) close(false)
    }
    document.addEventListener("pointerdown", away, true)
    onCleanup(() => document.removeEventListener("pointerdown", away, true))
  })
  const keys = (event: KeyboardEvent) => {
    const items = [...(element?.querySelectorAll<HTMLElement>("[role=option]") ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
    }
    if (event.key === "Tab") close(false)
  }
  return (
    <div ref={element} data-component="dropdown" data-id={props.id} data-show={show()}>
      <button
        type="button"
        data-slot="dropdown-trigger"
        aria-label={`${props.label}: ${current()?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => props.onOpen(open() ? undefined : props.id)}
      >
        <Show when={show() !== "value"}>
          <span data-slot="tool-icon">{props.trigger ?? current()?.icon}</span>
        </Show>
        <Show when={show() !== "icon"}>
          <span data-slot="dropdown-value">{current()?.label}</span>
        </Show>
        <Show when={current()?.explicit}>
          <em data-slot="explicit" title="Explicit lyrics">
            E
          </em>
        </Show>
        <Chevron />
      </button>
      <Show when={open()}>
        <div data-slot="dropdown-menu" role="listbox" aria-label={props.label} onKeyDown={keys}>
          <For each={props.options}>
            {(item) => (
              <button
                type="button"
                role="option"
                data-slot="dropdown-item"
                aria-selected={item.value === props.value}
                onClick={() => {
                  props.onSelect(item.value)
                  close(true)
                }}
              >
                <Show when={item.icon}>
                  <span data-slot="tool-icon">{item.icon}</span>
                </Show>
                <span data-slot="dropdown-label">
                  {item.label}
                  <Show when={item.detail}>
                    <small>{item.detail}</small>
                  </Show>
                </span>
                <Show when={item.explicit}>
                  <em data-slot="explicit" title="Explicit lyrics">
                    Explicit
                  </em>
                </Show>
                <svg data-slot="check" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function Chevron() {
  return (
    <svg data-slot="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

// A track's cover, or the muted speaker for No music; with `state`, the play state over it (the bar's chosen track).
function MusicCover(props: { cover?: string; state?: "playing" | "paused" }) {
  return (
    <i data-slot="music-cover" aria-hidden="true">
      <Show
        when={props.cover}
        fallback={
          <svg width="14" height="14" viewBox="0 0 16 16">
            <path d="M1 6h2.5L7 3v10L3.5 10H1Z" fill="currentColor" />
            <path d="m10.5 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
          </svg>
        }
      >
        {(cover) => <img src={cover()} alt="" width="24" height="24" />}
      </Show>
      <Show when={props.state}>
        <span data-slot="music-state">
          <Show
            when={props.state === "playing"}
            fallback={
              <svg width="10" height="10" viewBox="0 0 16 16">
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
        </span>
      </Show>
    </i>
  )
}

// Lead with: rising bars for the top model, one block for the total.
function LeadGlyph(props: { lead: "top" | "total" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <Show when={props.lead === "top"} fallback={<path d="M3 3h10v10H3z" fill="currentColor" />}>
        <path d="M3 13V7h3v6zM6.5 13V3h3v10zM10 13V9h3v4z" fill="currentColor" />
      </Show>
    </svg>
  )
}

// The type icons: a play triangle in a frame, a picture, and the angle brackets of code.
function TypeGlyph(props: { format: "video" | "image" | "embed" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <Show when={props.format === "video"}>
        <path d="M5.5 4.5v7l6-3.5z" fill="currentColor" />
      </Show>
      <Show when={props.format === "image"}>
        <g fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2.75 3.25h10.5v9.5H2.75zM3 12l3.5-4 3 3 1.5-1.5 2.25 2.5" />
        </g>
      </Show>
      <Show when={props.format === "embed"}>
        <path
          d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
      </Show>
    </svg>
  )
}

// The track after or before `current` in the music list, No music first, round and round.
function stepTrack(current: string, direction: 1 | -1) {
  const ids = ["none", ...shareTracks.map((item) => item.id)]
  return ids[(ids.indexOf(current) + direction + ids.length) % ids.length]!
}

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

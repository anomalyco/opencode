import "./share.css"
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
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
import { useI18n } from "../context/i18n"
import { useLanguage } from "../context/language"
import { translate } from "../i18n"
import { dataFlag } from "../lib/flag"
import { route, type Locale } from "../lib/language"
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

/**
 * The share icon in a section's heading. `card` reads the section's current view when it's pressed, in the page's
 * language.
 */
export function ShareButton(props: { card: (locale: Locale) => ShareDraft | undefined; label: string }) {
  if (!dataFlag("share")) return null
  const language = useLanguage()
  const i18n = useI18n()
  let element: HTMLButtonElement | undefined
  onMount(() => {
    if (!element) return
    const entry = { element, card: () => props.card(language.locale()) }
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
      aria-expanded={request() !== undefined && request()?.id === props.card(language.locale())?.id ? "true" : "false"}
      onClick={(event) => {
        const card = props.card(language.locale())
        if (!card) return
        opener = event.currentTarget
        setRequest(card)
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.5">
          {/* The share sign: an arrow rising out of a tray. */}
          <path d="M8 1.75v8.5M5.25 4.5 8 1.75l2.75 2.75M2.75 9v4.25h10.5V9" />
        </g>
      </svg>
      <span>{i18n.t("share.open")}</span>
    </button>
  )
}

const sizes = [
  { value: "4:5", label: "share.size.feed" },
  { value: "1:1", label: "share.size.square" },
  { value: "9:16", label: "share.size.story" },
  { value: "16:9", label: "share.size.wide" },
] as const

const layouts = [
  { value: "headline", label: "share.layout.headline" },
  { value: "number", label: "share.layout.number" },
  { value: "chart", label: "share.layout.title" },
] as const

/**
 * The share editor, mounted once on the page: the card in the middle, its options beside it (under it on phones, one
 * group at a time), and Copy link and Export in the top bar. Images and videos come from the same drawing code as
 * the preview (card.ts).
 */
export function ShareDialog(props: { updatedAt: string | null; url: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  let dialog: HTMLDialogElement | undefined
  let preview: HTMLCanvasElement | undefined
  // The card's width on screen, for the embed code under it to match.
  const [cardBox, setCardBox] = createSignal({ left: 0, top: 0, width: 0, height: 0 })
  const cardWidth = () => cardBox().width
  // The fill of the thin bar under the card that follows the video preview as it plays.
  let playhead: HTMLElement | undefined
  let audio: HTMLAudioElement | undefined
  const [format, setFormat] = createSignal<"image" | "video" | "embed">("video")
  // An embed shows the latest data by default; a fixed one keeps today's numbers (share/embed.ts).
  const [fixed, setFixed] = createSignal(false)
  const [snippet, setSnippet] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  const [notice, setNotice] = createSignal<string>()
  const [rendering, setRendering] = createSignal<number>()
  // Cancel shows on hover only once the pointer has left the button since Export was pressed, so the press that
  // started the render doesn't flash Cancel under it.
  const [cancelReady, setCancelReady] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [playing, setPlaying] = createSignal(true)
  // The chosen track, and whether the video is muted; muting keeps the choice for unmuting.
  const [track, setTrack] = createSignal(shareTracks[0]?.id ?? "")
  const [muted, setMuted] = createSignal(false)
  // The track under the pointer in the open music list, playing in place of the chosen one until the list closes.
  const [hovered, setHovered] = createSignal<string>()
  // The open dropdown or the date picker, by id; one at a time.
  const [menu, setMenu] = createSignal<string>()
  // The editor opens on the card alone, the modal hugging it, with Close, Customize and Export; Customize reveals every
  // setting, Mute and Shuffle, and the modal grows to its full size around them.
  const [customizing, setCustomizing] = createSignal(false)
  const [viewport, setViewport] = createSignal<{ width: number; height: number }>()
  onMount(() => {
    const measure = () => setViewport({ width: innerWidth, height: innerHeight })
    measure()
    addEventListener("resize", measure)
    onCleanup(() => removeEventListener("resize", measure))
  })
  // The card as large as the full modal would show it, with the stage's padding across, and down the bar over it, the
  // stage's padding and the section arrows under it (share.css). Never narrower than the bar's own buttons need.
  const hug = () => {
    const view = viewport()
    if (!view) return undefined
    const full = { width: Math.min(1200, view.width - 160), height: Math.min(800, view.height - 128) }
    const across = 96
    const down = 52 + 64 + 12 + 64
    const [width, height] = size()
    const scale = Math.min(1, (full.width - across) / width, (full.height - down) / height)
    return { width: Math.max(400, Math.round(width * scale + across)), height: Math.round(height * scale + down) }
  }
  const customize = () => {
    setCustomizing(true)
    // Its button goes, so the focus moves on to the first setting.
    requestAnimationFrame(() => bar?.querySelector<HTMLElement>("[data-slot=dropdown-trigger]")?.focus())
  }

  // The bar compacts only when it has to: its full layout first, then step by step (share.css data-compact) until it
  // fits on one row. On phones the settings are in the sheet and this stays off.
  let bar: HTMLDivElement | undefined
  const fitBar = () => {
    if (!bar) return
    const wide = matchMedia("(min-width: 761px)").matches
    const rows = () => {
      const items = [...bar!.children].filter(
        (item): item is HTMLElement => item instanceof HTMLElement && item.offsetParent !== null,
      )
      return new Set(items.map((item) => item.offsetTop)).size
    }
    for (const level of wide ? [0, 1, 2, 3] : [0]) {
      bar.dataset.compact = String(level)
      if (rows() <= 1) return
    }
  }
  createEffect(() => {
    format()
    leads()
    day()
    track()
    starts()
    if (!card()) return
    requestAnimationFrame(fitBar)
  })
  // Counts Shuffle presses: each one spins the changed settings' reels, like an odometer, to their new values.
  const [rolls, setRolls] = createSignal(0)
  const roll = () => setRolls((count) => count + 1)
  // On phones, the settings sheet: closed until Settings opens it.
  const [sheet, setSheet] = createSignal(false)
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
  // A bar chart over its range drawn as bars, or as a race of the leaders overtaking each other (card.ts drawRace).
  // Over a range: bars or a race; for one day: bars, a ranked list or a dot matrix. A style that doesn't
  // suit the chart shows as its bars.
  const [chartStyle, setChartStyle] = createSignal<"bars" | "race" | "list" | "dots">("bars")
  const raceable = () => starts().length > 1
  const chartStyles = () => (day() === undefined ? (["bars", "race"] as const) : (["bars", "list", "dots"] as const))
  const style = () => ((chartStyles() as readonly string[]).includes(chartStyle()) ? chartStyle() : "bars")
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
    return index === undefined
      ? shareRangeLabel(language.locale(), starts(), weekly())
      : shareDayLabel(language.locale(), starts()[index] ?? "", weekly())
  }
  const card = createMemo(() => {
    const value = request()
    if (!value) return undefined
    const focus = { day: day(), lead: lead() }
    const chosen = focus.day === undefined && focus.lead === "top" ? value : (value.variant?.(focus) ?? value)
    const chart =
      style() !== "bars" && chosen.chart.kind === "stacked"
        ? { ...chosen.chart, style: style() as "race" | "list" | "dots" }
        : chosen.chart
    return { ...chosen, chart, variant: undefined, updatedAt: props.updatedAt, url: props.url }
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
  const chosen = createMemo(() => shareTracks.find((item) => item.id === track()))
  const music = createMemo(() => {
    const id = hovered()
    if (id) return shareTracks.find((item) => item.id === id)
    return muted() ? undefined : chosen()
  })
  const silent = () => !chosen()
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
    // In the card's language, which the embed page takes from its path.
    const url = embedUrl(
      new URL(route(value.locale, import.meta.env.BASE_URL), location.origin).toString(),
      value,
      opts,
    )
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
  // The video being rendered, to stop when Cancel is pressed or the editor closes.
  let renderAbort: AbortController | undefined
  let closing: ReturnType<typeof setTimeout> | undefined

  // Load the card's font with the page, so the preview is ready the moment the editor opens.
  onMount(() => void loadShareFonts())

  // Opening sets the settings itself (from last time, or at random); only changes made after are remembered.
  let opening = false
  createEffect(() => {
    const value = request()
    if (!value) return
    clearTimeout(closing)
    setNotice(undefined)
    // Stepping to another section keeps the editor open, its music and its options.
    if (dialog?.open) return
    opening = true
    setCustomizing(false)
    // Each opening plays from the start, even on the same card as last time.
    clock.key = ""
    setMenu(undefined)
    setSheet(false)
    // The settings from last time, once they were changed; otherwise a card made at random that opens silent, with no
    // music until one is chosen (or Shuffle picks one).
    if (!restoreSettings()) {
      setFormat("video")
      shuffle()
      setTrack("none")
    }
    // Never playing on opening: a remembered track waits, muted, until it's unmuted or chosen again.
    setMuted(true)
    // The card it opens on is where undo stops; changes from here on are remembered.
    queueMicrotask(() => {
      opening = false
      history.past = []
      history.future = []
    })
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
  // The running preview's loop, for seeking from the timeline under the card.
  let loop: { length: number; sound: ShareTrack | undefined } = { length: 0, sound: undefined }

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
    loop = { length, sound }
    // Any change to the card, a Shuffle (even one that lands on the same card) or a new track starts the video over,
    // from its blank card.
    const key = [
      value.id,
      sound?.id ?? "none",
      format(),
      playing(),
      opts.layout,
      opts.size,
      opts.theme,
      lead(),
      style(),
      day() ?? "",
      rolls(),
    ].join(" ")
    if (clock.key !== key) clock = { key, start: performance.now(), loop: -1 }
    const frame = () => {
      const elapsed = (performance.now() - clock.start) / 1000
      const turn = Math.floor(elapsed / length)
      if (turn !== clock.loop) {
        clock.loop = turn
        restartAudio(sound)
      }
      // The pause between loops stays on the blank card the next one opens on, not the finished card.
      const at = elapsed - turn * length
      drawShareCard(ctx, value, opts, at > length - 0.6 ? 0 : at, timing())
      if (playhead) playhead.style.scale = `${Math.min(1, (elapsed - turn * length) / length)} 1`
      handle = requestAnimationFrame(frame)
    }
    let handle = requestAnimationFrame(frame)
    onCleanup(() => cancelAnimationFrame(handle))
  })

  // Moves the video preview, and its music, to `fraction` of the way through; a paused preview plays from there.
  const seek = (fraction: number) => {
    if (format() !== "video") return
    if (!playing()) setPlaying(true)
    if (!loop.length) return
    const at = Math.max(0, Math.min(1, fraction)) * loop.length
    const turn = Math.max(0, clock.loop)
    clock.loop = turn
    clock.start = performance.now() - (turn * loop.length + at) * 1000
    if (!loop.sound) return
    restartAudio(loop.sound)
    if (audio) audio.currentTime = at
  }
  const seekFrom = (event: PointerEvent, element: HTMLElement) => {
    const box = element.getBoundingClientRect()
    seek((event.clientX - box.left) / box.width)
  }
  const progress = () => {
    if (!loop.length) return 0
    const elapsed = (performance.now() - clock.start) / 1000
    return (elapsed % loop.length) / loop.length
  }

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

  // A card made at random: every setting but the type, which is for choosing on purpose, and the date, which belongs
  // to its section. Any layout and style, a size for a feed or a story (not Wide), and a clean track. Muted stays
  // muted: the track still changes, ready for unmuting. Playing from the start again, as each opening does.
  const shuffle = () =>
    batch(() => {
      setFixed(pick([false, true] as const))
      setShareOption("layout", pick(layouts).value)
      setShareOption("size", pick(sizes.filter((item) => item.value !== "16:9")).value)
      setShareOption("theme", pick(["dark", "light", "leader"] as const))
      // Never an explicit track: those are for choosing on purpose.
      setTrack(pick(shareTracks.filter((item) => !item.explicit)).id)
      setLead(pick(["top", "total"] as const))
      setChartStyle(pick(chartStyles()))
      setPlaying(true)
    })

  // Undo and redo (⌘Z, ⇧⌘Z) for the settings. Each change, Shuffle as one, keeps the settings before it; the history
  // starts again with each section, and each opening, so undo never reaches back past the card in front of you.
  const settings = createMemo(
    () => ({
      section: request()?.id,
      format: format(),
      day: day(),
      lead: lead(),
      chart: chartStyle(),
      layout: options().layout,
      size: options().size,
      theme: options().theme,
      track: track(),
      muted: muted(),
      fixed: fixed(),
    }),
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  )
  const history = { past: [] as ReturnType<typeof settings>[], future: [] as ReturnType<typeof settings>[] }
  let last: ReturnType<typeof settings> | undefined
  let restoring = false
  createEffect(() => {
    const now = settings()
    if (last?.section !== now.section) {
      history.past = []
      history.future = []
    } else if (last && !restoring) {
      history.past.push(last)
      history.future = []
    }
    // Remembered for next time: every change made in the open editor, past its opening.
    if (!opening && dialog?.open && last?.section === now.section) saveSettings(now)
    restoring = false
    last = now
  })
  // The remembered settings, in this browser: all but the date, which belongs to its section.
  const settingsKey = "opencode-data-share-settings"
  const saveSettings = (value: ReturnType<typeof settings>) => {
    const { section, day, ...kept } = value
    try {
      localStorage.setItem(settingsKey, JSON.stringify(kept))
    } catch {
      // Storage full or blocked: the settings just aren't remembered.
    }
  }
  const restoreSettings = () => {
    const saved = parseSettings(localStorage.getItem(settingsKey))
    if (!saved) return false
    batch(() => {
      setFormat(saved.format)
      setLead(saved.lead)
      setChartStyle(saved.chart)
      setShareOption("layout", saved.layout)
      setShareOption("size", saved.size)
      setShareOption("theme", saved.theme)
      setTrack(saved.track)
      setMuted(saved.muted)
      setFixed(saved.fixed)
    })
    return true
  }
  const travel = (redo: boolean) => {
    const target = (redo ? history.future : history.past).pop()
    const now = last
    if (!target || !now) return
    ;(redo ? history.past : history.future).push(now)
    restoring = true
    batch(() => {
      setFormat(target.format)
      setDay(target.day)
      setLead(target.lead)
      setChartStyle(target.chart)
      setShareOption("layout", target.layout)
      setShareOption("size", target.size)
      setShareOption("theme", target.theme)
      setTrack(target.track)
      setMuted(target.muted)
      setFixed(target.fixed)
    })
  }

  const file = async (kind: "image" | "video") => {
    const value = card()
    if (!value) throw new Error(i18n.t("share.error.empty"))
    await loadShareLogos(cardLogos(value.chart))
    if (kind === "image") return renderImage(value, options())
    const key = JSON.stringify([value, options(), music()?.id])
    if (video?.key !== key) {
      setCancelReady(false)
      setRendering(0)
      video = {
        key,
        file: renderVideo(
          value,
          options(),
          music(),
          timing(),
          setRendering,
          (renderAbort = new AbortController()).signal,
        )
          .catch((error: unknown) => {
            // A cancelled or failed render isn't kept, so the next Export starts again.
            video = undefined
            throw error
          })
          .finally(() => setRendering(undefined)),
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
      setNotice(error instanceof Error ? error.message : i18n.t("share.error.generic"))
    }
  }

  // Export saves the PNG or the video. On phones, where saving a file goes nowhere useful, it opens the share sheet.
  const exportFile = () => {
    // While a video renders, the button is Cancel.
    if (rendering() !== undefined) return renderAbort?.abort()
    return run(async () => {
      const kind = format()
      // The button says Copied for a moment instead of a notice.
      if (kind === "embed") {
        await copyText(snippet(), dialog, i18n.t("share.error.copy"))
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
      return i18n.t(kind === "image" ? "share.saved.image" : "share.saved.video")
    })
  }

  // Pressing the chosen track again plays or pauses it, with the preview.
  const chooseTrack = (id: string) => {
    if (id === track() && id !== "none" && !muted()) return setPlaying(!playing())
    setTrack(id)
    setMuted(false)
    setPlaying(true)
  }

  return (
    <dialog
      ref={dialog}
      data-component="share-editor"
      data-customize={customizing() ? "" : undefined}
      style={
        hug()
          ? ({ "--hug-width": `${hug()!.width}px`, "--hug-height": `${hug()!.height}px` } as JSX.CSSProperties)
          : undefined
      }
      aria-label={i18n.t("share.open")}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return
        event.preventDefault()
        travel(event.shiftKey)
      }}
      // Escape closes it natively; a click on the backdrop lands on the dialog itself, since the editor fills its box.
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      // Escape closes an open dropdown first, then the editor.
      onCancel={(event) => {
        if (!menu() && !sheet()) return
        event.preventDefault()
        if (menu()) return setMenu(undefined)
        setSheet(false)
      }}
      onClose={() => {
        renderAbort?.abort()
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
            <div
              ref={(element) => {
                bar = element
                const observer = new ResizeObserver(() => fitBar())
                observer.observe(element)
                onCleanup(() => observer.disconnect())
              }}
              data-slot="editor-bar"
              role="toolbar"
              aria-label={i18n.t("share.openSection", { title: value().title })}
            >
              <button
                type="button"
                data-slot="icon-button"
                aria-label={i18n.t("share.close")}
                data-tooltip={i18n.t("share.close")}
                onClick={close}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </button>
              {/* Phones only: the settings live in a sheet, opened from here. */}
              <button
                type="button"
                data-slot="sheet-open"
                aria-expanded={sheet() ? "true" : "false"}
                aria-controls="share-settings"
                onClick={() => setSheet(true)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2 4.5h6M12 4.5h2M2 11.5h2M8 11.5h6M10 4.5a1.75 1.75 0 1 1 0 .01M6 11.5a1.75 1.75 0 1 1 0 .01"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                </svg>
                <span>{i18n.t("share.settings")}</span>
              </button>
              <Show when={sheet()}>
                <div data-slot="sheet-backdrop" aria-hidden="true" onClick={() => setSheet(false)} />
              </Show>
              {/* Every setting: in the bar on wider screens; on phones a sheet that slides up from the bottom. */}
              <div
                id="share-settings"
                data-slot="bar-settings"
                data-open={sheet() ? "" : undefined}
                role="group"
                aria-label={i18n.t("share.settings")}
              >
                <div data-slot="sheet-head">
                  <strong>{i18n.t("share.settings")}</strong>
                  <button type="button" data-slot="sheet-done" onClick={() => setSheet(false)}>
                    {i18n.t("share.done")}
                  </button>
                </div>
                <Dropdown
                  id="type"
                  label={i18n.t("share.type")}
                  open={menu()}
                  onOpen={setMenu}
                  value={format()}
                  options={(["video", "image", "embed"] as const).map((item) => ({
                    value: item,
                    label: i18n.t(`share.type.${item}`),
                    icon: <TypeGlyph format={item} />,
                  }))}
                  onSelect={(item) => {
                    setFormat(item)
                    setPlaying(true)
                  }}
                />
                <Show when={starts().length > 1}>
                  <div data-slot="date-tool">
                    <span data-slot="sheet-label">{i18n.t("share.date")}</span>
                    <button
                      type="button"
                      data-slot="dropdown-trigger"
                      aria-label={i18n.t("share.option", { label: i18n.t("share.date"), value: dateLabel() })}
                      aria-haspopup="dialog"
                      data-tooltip={i18n.t("share.date")}
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
                    roll={rolls()}
                    rollDelay={45}
                    label={i18n.t("share.lead")}
                    open={menu()}
                    onOpen={setMenu}
                    value={lead()}
                    options={[
                      { value: "top" as const, label: i18n.t("share.lead.top"), icon: <LeadGlyph lead="top" /> },
                      { value: "total" as const, label: i18n.t("share.lead.total"), icon: <LeadGlyph lead="total" /> },
                    ]}
                    onSelect={setLead}
                  />
                </Show>
                <Show when={raceable()}>
                  <Dropdown
                    id="chart"
                    label={i18n.t("share.chart")}
                    roll={rolls()}
                    rollDelay={90}
                    open={menu()}
                    onOpen={setMenu}
                    value={style()}
                    options={chartStyles().map((item) => ({
                      value: item,
                      label: i18n.t(`share.chart.${item}`),
                      icon: <ChartGlyph style={item} />,
                    }))}
                    onSelect={setChartStyle}
                  />
                </Show>
                <Dropdown
                  id="layout"
                  roll={rolls()}
                  rollDelay={135}
                  label={i18n.t("share.layout")}
                  open={menu()}
                  onOpen={setMenu}
                  value={options().layout}
                  options={layouts.map((item) => ({
                    value: item.value,
                    label: i18n.t(item.label),
                    icon: <LayoutGlyph layout={item.value} />,
                  }))}
                  onSelect={(item) => setShareOption("layout", item)}
                />
                <Dropdown
                  id="size"
                  roll={rolls()}
                  rollDelay={180}
                  label={i18n.t("share.size")}
                  open={menu()}
                  onOpen={setMenu}
                  value={options().size}
                  show="value"
                  options={sizes.map((item) => ({
                    value: item.value,
                    label: item.value,
                    detail: i18n.t(item.label),
                    icon: <AspectGlyph size={item.value} />,
                  }))}
                  onSelect={(item) => setShareOption("size", item)}
                />
                <Dropdown
                  id="style"
                  roll={rolls()}
                  rollDelay={270}
                  label={i18n.t("share.style")}
                  open={menu()}
                  onOpen={setMenu}
                  value={options().theme}
                  options={(["dark", "light", "leader"] as const).map((item) => ({
                    value: item,
                    label: i18n.t(
                      ({ dark: "share.style.dark", light: "share.style.light", leader: "share.style.top" } as const)[
                        item
                      ],
                    ),
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
                    roll={rolls()}
                    rollDelay={315}
                    label={i18n.t("share.data")}
                    open={menu()}
                    onOpen={setMenu}
                    value={fixed() ? "fixed" : "live"}
                    options={[
                      {
                        value: "live" as const,
                        label: i18n.t("share.data.live"),
                        icon: <DataGlyph fixed={false} />,
                      },
                      {
                        value: "fixed" as const,
                        label: i18n.t("share.data.fixed"),
                        icon: <DataGlyph fixed />,
                      },
                    ]}
                    onSelect={(item) => setFixed(item === "fixed")}
                  />
                </Show>
                <Show when={format() === "video"}>
                  <div data-slot="music-tool" role="group" aria-label={i18n.t("share.music")}>
                    <span data-slot="sheet-label">{i18n.t("share.music")}</span>
                    <Dropdown
                      id="music"
                      roll={rolls()}
                      rollDelay={360}
                      label={i18n.t("share.music")}
                      open={menu()}
                      onOpen={setMenu}
                      value={track()}
                      options={[
                        { value: "none", label: i18n.t("share.music.none"), icon: <MusicCover /> },
                        ...shareTracks.map((item) => ({
                          value: item.id,
                          label: item.name,
                          explicit: item.explicit,
                          icon: <MusicCover cover={item.cover} />,
                        })),
                      ]}
                      show="both"
                      onPreview={(id) => {
                        setHovered(id)
                        if (id) setPlaying(true)
                      }}
                      trigger={
                        <MusicCover
                          cover={chosen()?.cover}
                          state={muted() || silent() ? undefined : playing() ? "playing" : "paused"}
                        />
                      }
                      onSelect={chooseTrack}
                    />
                  </div>
                </Show>
              </div>
              {/* The bar's far end: Mute (for a video), Shuffle, then Export. */}
              <div data-slot="bar-end">
                <Show when={format() === "video" && !silent()}>
                  <button
                    type="button"
                    data-slot="icon-button"
                    aria-label={i18n.t("share.music.mute")}
                    aria-pressed={muted()}
                    data-tooltip={i18n.t(muted() ? "share.unmute" : "share.mute")}
                    onClick={() => {
                      setMuted(!muted())
                      setPlaying(true)
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M1 6h2.5L7 3v10L3.5 10H1Z" fill="currentColor" />
                      <Show
                        when={muted()}
                        fallback={
                          <path
                            d="M9.5 5.5a3.5 3.5 0 0 1 0 5M11.5 3.5a6.5 6.5 0 0 1 0 9"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                          />
                        }
                      >
                        <path
                          d="m10.5 6 4 4m0-4-4 4"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="square"
                        />
                      </Show>
                    </svg>
                  </button>
                </Show>
                <button
                  type="button"
                  data-slot="icon-button"
                  aria-label={i18n.t("share.shuffle")}
                  data-tooltip={i18n.t("share.shuffle")}
                  onClick={() => {
                    shuffle()
                    roll()
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <g fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M2 4.5h2.5c3.5 0 3.5 7 7 7H14M2 11.5h2.5c1.4 0 2.2-1.1 2.9-2.4M14 4.5h-2.5c-1.4 0-2.2 1.1-2.9 2.4" />
                      <path d="m12 2.5 2 2-2 2M12 9.5l2 2-2 2" />
                    </g>
                  </svg>
                </button>
                <Show when={!customizing()}>
                  <button type="button" data-slot="bar-button" data-variant="customize" onClick={customize}>
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M2 4.5h6M12 4.5h2M2 11.5h2M8 11.5h6M10 4.5a1.75 1.75 0 1 1 0 .01M6 11.5a1.75 1.75 0 1 1 0 .01"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                      />
                    </svg>
                    {i18n.t("share.customize")}
                  </button>
                </Show>
                <button
                  type="button"
                  data-slot="bar-button"
                  data-variant="primary"
                  data-rendering={rendering() !== undefined ? "" : undefined}
                  data-cancel={cancelReady() ? "" : undefined}
                  onPointerLeave={() => setCancelReady(true)}
                  // While a video renders, the button is its progress bar: it fills from the left as the frames go.
                  style={{ "--progress": `${(rendering() ?? 0) * 100}%` } as JSX.CSSProperties}
                  aria-live="polite"
                  aria-label={
                    rendering() !== undefined
                      ? i18n.t("share.export.cancel")
                      : i18n.t(
                          (
                            {
                              image: "share.export.image",
                              video: "share.export.video",
                              embed: "share.copyEmbed",
                            } as const
                          )[format()],
                        )
                  }
                  onClick={exportFile}
                >
                  {/* While it renders: the percentage, turning to Cancel under the pointer or keyboard focus. */}
                  <Show when={rendering() !== undefined}>
                    <span data-slot="button-cancel">{i18n.t("share.cancel")}</span>
                  </Show>
                  <Show when={rendering() !== undefined ? "rendering" : copied() ? "copied" : "export"} keyed>
                    <span data-slot="button-label">
                      {rendering() !== undefined
                        ? `${Math.round((rendering() ?? 0) * 100)}%`
                        : copied()
                          ? i18n.t("share.copied")
                          : format() === "embed"
                            ? i18n.t("share.copyEmbed")
                            : i18n.t("share.export")}
                    </span>
                  </Show>
                </button>
              </div>
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
              <div data-slot="editor-canvas">
                <canvas
                  ref={(element) => {
                    preview = element
                    // Where the card sits in its area, for the playback bar and the embed code under it.
                    const observer = new ResizeObserver(() =>
                      setCardBox({
                        left: element.offsetLeft,
                        top: element.offsetTop,
                        width: element.offsetWidth,
                        height: element.offsetHeight,
                      }),
                    )
                    observer.observe(element)
                    if (element.parentElement) observer.observe(element.parentElement)
                    onCleanup(() => observer.disconnect())
                  }}
                  data-slot="share-preview"
                  role="img"
                  aria-label={value().headline}
                  style={{ "aspect-ratio": `${size()[0]} / ${size()[1]}` }}
                />
                {/* A video's playback: a thin bar just under the card, filling as the preview plays. */}
                <Show when={format() === "video"}>
                  {/* A timeline: press or drag along it to move the video and its music; the arrow keys step a second. */}
                  <div
                    data-slot="playback"
                    role="slider"
                    tabIndex={0}
                    aria-label={i18n.t("share.position")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={0}
                    style={{
                      left: `${cardBox().left}px`,
                      top: `${cardBox().top + cardBox().height - 1}px`,
                      width: `${cardBox().width}px`,
                    }}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      seekFrom(event, event.currentTarget)
                    }}
                    onPointerMove={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFrom(event, event.currentTarget)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                      event.preventDefault()
                      seek(progress() + (event.key === "ArrowLeft" ? -1 : 1) / Math.max(1, loop.length))
                    }}
                  >
                    <span data-slot="playback-track">
                      <i ref={playhead} />
                    </span>
                  </div>
                </Show>
              </div>
              {/* An embed's code under the card, as wide as it, highlighted as it will be copied; pressing it copies it too.
                  It opens by growing, so the card eases smaller to make room rather than jumping. */}
              <div
                data-slot="embed-drawer"
                data-open={format() === "embed" && snippet() ? "" : undefined}
                style={{ width: `${cardWidth()}px` }}
              >
                <div data-slot="embed-drawer-inner">
                  {/* Copying shows here as well as on the button, where the press was. */}
                  <Show when={copied()}>
                    <span data-slot="embed-copied" aria-hidden="true">
                      {i18n.t("share.copied")}
                    </span>
                  </Show>
                  <button
                    type="button"
                    data-slot="embed-code"
                    aria-label={i18n.t("share.copyEmbed")}
                    tabIndex={format() === "embed" ? 0 : -1}
                    onClick={exportFile}
                  >
                    <code>
                      <For each={tokens(snippet())}>{(token) => <span data-token={token.kind}>{token.text}</span>}</For>
                    </code>
                  </button>
                </div>
              </div>
              {/* Under the card, the section's name between arrows that step to the previous and next section; a saved or
                  copied notice takes the name's place for a moment. */}
              <div data-slot="editor-toolbar">
                <button
                  type="button"
                  data-slot="icon-button"
                  aria-label={i18n.t("share.previous")}
                  data-tooltip={i18n.t("share.previous")}
                  onClick={() => step(-1)}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-mirror>
                    <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </button>
                <span data-slot="editor-meta" role="status" aria-live="polite">
                  {notice() ?? value().title}
                </span>
                <button
                  type="button"
                  data-slot="icon-button"
                  aria-label={i18n.t("share.next")}
                  data-tooltip={i18n.t("share.next")}
                  onClick={() => step(1)}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-mirror>
                    <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </dialog>
  )
}

// Copies `text`: the Clipboard API, or where a browser refuses it (no focus, no permission) a selected hidden field
// inside the editor and the copy command, which the top-layer dialog lets through.
async function copyText(text: string, host: HTMLElement | undefined, failure: string) {
  const written = await navigator.clipboard?.writeText(text).then(
    () => true,
    () => false,
  )
  if (written) return
  const field = document.createElement("textarea")
  field.value = text
  field.setAttribute("readonly", "")
  field.style.position = "fixed"
  field.style.opacity = "0"
  ;(host ?? document.body).append(field)
  field.select()
  const copied = document.execCommand("copy")
  field.remove()
  if (!copied) throw new Error(failure)
}

// The embed code split for highlighting: the tag's name, each attribute's name and quoted value, and the brackets.
function tokens(code: string) {
  return [...code.matchAll(/(<\/?)([\w-]+)|([\w-]+)(=)("[^"]*")|(>)|(\s+)/g)].flatMap((match) => {
    if (match[2])
      return [
        { kind: "punctuation", text: match[1]! },
        { kind: "tag", text: match[2] },
      ]
    if (match[3])
      return [
        { kind: "attribute", text: match[3] },
        { kind: "punctuation", text: match[4]! },
        { kind: "string", text: match[5]! },
      ]
    return [{ kind: match[6] ? "punctuation" : "space", text: match[0] }]
  })
}

// Settings saved by an earlier visit, if they're still all valid choices.
function parseSettings(raw: string | null) {
  const value: unknown = (() => {
    try {
      return raw ? JSON.parse(raw) : undefined
    } catch {
      return undefined
    }
  })()
  if (!value || typeof value !== "object") return undefined
  const item = value as Record<string, unknown>
  const one = <T extends string>(key: string, choices: readonly T[]) => choices.find((choice) => choice === item[key])
  const format = one("format", ["video", "image", "embed"] as const)
  const lead = one("lead", ["top", "total"] as const)
  const chart = one("chart", ["bars", "race", "list", "dots"] as const)
  const layout = one(
    "layout",
    layouts.map((entry) => entry.value),
  )
  const size = one(
    "size",
    sizes.map((entry) => entry.value),
  )
  const theme = one("theme", ["dark", "light", "leader"] as const)
  const track = one("track", ["none", ...shareTracks.map((entry) => entry.id)])
  if (!format || !lead || !chart || !layout || !size || !theme || !track) return undefined
  return { format, lead, chart, layout, size, theme, track, muted: item.muted === true, fixed: item.fixed === true }
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
  // Shuffle's count: each change spins a reel of random choices that lands on the value, starting rollDelay ms in.
  roll?: number
  rollDelay?: number
  // Called with the choice under the pointer or keyboard focus while the list is open, and with undefined once it closes.
  onPreview?: (value: T | undefined) => void
  trigger?: JSX.Element
  onSelect: (value: T) => void
}) {
  const i18n = useI18n()
  const show = () => props.show ?? "icon"
  // The reel: random choices, then the value, scrolled up through the button like an odometer's wheel.
  const [reel, setReel] = createSignal<T[]>()
  createEffect(
    on(
      () => props.roll,
      () => {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
        if (props.options.length < 2) return
        // Built back from the value, each row a different choice from the one after it, so the reel visibly turns
        // even with only two choices, flipping between them.
        const turns = Array.from({ length: 9 }).reduce<T[]>(
          (list) => {
            const others = props.options.filter((item) => item.value !== list[0])
            return [others[Math.floor(Math.random() * others.length)]!.value, ...list]
          },
          [props.value],
        )
        setReel(turns)
      },
      { defer: true },
    ),
  )
  const option = (value: T) => props.options.find((item) => item.value === value)
  let element: HTMLDivElement | undefined
  const open = () => props.open === props.id
  const current = () => props.options.find((item) => item.value === props.value)
  // The Explicit badge in the button: the whole word when the name still fits beside it, E when it would be cut off.
  const [short, setShort] = createSignal(false)
  createEffect(() => {
    if (!current()?.explicit) return
    setShort(false)
    const frame = requestAnimationFrame(() => {
      const value = element?.querySelector<HTMLElement>("[data-slot=dropdown-trigger] [data-slot=dropdown-value]")
      setShort(!!value && value.scrollWidth > value.clientWidth)
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })
  const close = (focus: boolean) => {
    props.onOpen(undefined)
    if (focus) element?.querySelector<HTMLElement>("[data-slot=dropdown-trigger]")?.focus()
  }
  // Opening focuses the chosen item, so the arrow keys start from it.
  createEffect(() => {
    if (!open()) return props.onPreview?.(undefined)
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
      <Show when={props.id !== "music"}>
        <span data-slot="sheet-label">{props.label}</span>
      </Show>
      <button
        type="button"
        data-slot="dropdown-trigger"
        aria-label={i18n.t("share.option", { label: props.label, value: current()?.label ?? "" })}
        aria-haspopup="listbox"
        data-tooltip={props.label}
        aria-expanded={open() ? "true" : "false"}
        onClick={() => props.onOpen(open() ? undefined : props.id)}
      >
        {/* Keyed, so a Shuffle while a reel still turns starts it over. */}
        <Show
          when={reel()}
          keyed
          fallback={
            <>
              <Show when={props.trigger ?? current()?.icon}>
                <span data-slot="tool-icon">{props.trigger ?? current()?.icon}</span>
              </Show>
              <span data-slot="dropdown-value">
                {current()?.label}
                <Show when={current()?.detail}>
                  <small data-slot="dropdown-detail"> {current()?.detail}</small>
                </Show>
              </span>
            </>
          }
        >
          {(items) => (
            <span data-slot="reel" aria-hidden="true">
              <span
                data-slot="reel-strip"
                style={{ "animation-delay": `${props.rollDelay ?? 0}ms` }}
                onAnimationEnd={() => setReel(undefined)}
              >
                <For each={items}>
                  {(value) => (
                    <span data-slot="reel-row">
                      <Show when={show() !== "value"}>
                        <span data-slot="tool-icon">{option(value)?.icon}</span>
                      </Show>
                      <Show when={show() !== "icon"}>
                        <span data-slot="dropdown-value">{option(value)?.label}</span>
                      </Show>
                    </span>
                  )}
                </For>
              </span>
            </span>
          )}
        </Show>
        <Show when={current()?.explicit}>
          <em data-slot="explicit" title={i18n.t("share.explicit.title")}>
            {i18n.t(short() ? "share.explicit.short" : "share.explicit")}
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
                onPointerEnter={() => props.onPreview?.(item.value)}
                onFocus={() => props.onPreview?.(item.value)}
                onClick={() => {
                  props.onSelect(item.value)
                  close(true)
                }}
              >
                <Show when={item.icon}>
                  <span data-slot="tool-icon">{item.icon}</span>
                </Show>
                <span data-slot="dropdown-label">
                  <span>{item.label}</span>
                  <Show when={item.detail}>
                    <small>{item.detail}</small>
                  </Show>
                </span>
                <Show when={item.explicit}>
                  <em data-slot="explicit" title={i18n.t("share.explicit.title")}>
                    {i18n.t("share.explicit")}
                  </em>
                </Show>
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

// A track's cover, with `state` the play state over it (the bar's chosen track); for No music, a plain speaker icon
// drawn like the bar's other icons.
function MusicCover(props: { cover?: string; state?: "playing" | "paused" }) {
  return (
    <Show
      when={props.cover}
      fallback={
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.75 6h2.5l3.25-2.75v9.5L4.25 10h-2.5zM10.25 6l4 4m0-4-4 4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      }
    >
      {(cover) => (
        <i data-slot="music-cover" aria-hidden="true">
          <img src={cover()} alt="" width="24" height="24" />
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
      )}
    </Show>
  )
}

// The embed's data: a broadcast for live, a padlock for fixed.
function DataGlyph(props: { fixed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.5">
        <Show
          when={props.fixed}
          fallback={
            <>
              <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
              <path d="M5.25 5a4 4 0 0 0 0 6M10.75 5a4 4 0 0 1 0 6M3.25 3a6.75 6.75 0 0 0 0 10M12.75 3a6.75 6.75 0 0 1 0 10" />
            </>
          }
        >
          <path d="M3.75 7.25h8.5v6.5h-8.5zM5.5 7.25V5a2.5 2.5 0 0 1 5 0v2.25" />
        </Show>
      </g>
    </svg>
  )
}

// A size's shape: its ratio as a rectangle, the longer side 12 units.
function AspectGlyph(props: { size: ShareOptions["size"] }) {
  const box = () => {
    const [width, height] = shareSizes[props.size]
    const scale = 12 / Math.max(width, height)
    return { width: width * scale, height: height * scale }
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x={(16 - box().width) / 2}
        y={(16 - box().height) / 2}
        width={box().width}
        height={box().height}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>
  )
}

// The chart's style: columns rising for bars, rows of different lengths for a race.
function ChartGlyph(props: { style: "bars" | "race" | "list" | "dots" }) {
  return (
    // Snapped to whole pixels: these lines fall between them at 20px, and blur thinner than the other icons' lines.
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
      <Show when={props.style === "list"}>
        <path d="M2.5 3.5h11M2.5 6h8M2.5 9.5h11M2.5 12h3" fill="none" stroke="currentColor" stroke-width="1.5" />
      </Show>
      <Show when={props.style === "dots"}>
        <g fill="currentColor">
          {[0, 1, 2, 3].flatMap((row) =>
            [0, 1, 2, 3].map((column) => <rect x={2.5 + column * 3} y={2.5 + row * 3} width="2" height="2" />),
          )}
        </g>
      </Show>
      <Show when={props.style === "bars" || props.style === "race"}>
        <Show
          when={props.style === "race"}
          fallback={
            <path d="M3.25 13.5V8M8 13.5V3M12.75 13.5V6" fill="none" stroke="currentColor" stroke-width="1.5" />
          }
        >
          <path d="M2.5 3.75h11M2.5 8h7M2.5 12.25h9" fill="none" stroke="currentColor" stroke-width="1.5" />
        </Show>
      </Show>
    </svg>
  )
}

// Lead with: a trophy for the top model, the sum sign for the total.
function LeadGlyph(props: { lead: "top" | "total" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.5">
        <Show when={props.lead === "top"} fallback={<path d="M12 3.25H4.25L8.5 8l-4.25 4.75H12" />}>
          <path d="M4.75 2.75h6.5v3a3.25 3.25 0 0 1-6.5 0zM4.75 4H2.75v.75a2.25 2.25 0 0 0 2.25 2.25M11.25 4h2v.75A2.25 2.25 0 0 1 11 7M8 9v4.25M5.25 13.25h5.5" />
        </Show>
      </g>
    </svg>
  )
}

// The type icons: a video camera, a picture, and the angle brackets of code.
function TypeGlyph(props: { format: "video" | "image" | "embed" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <Show when={props.format === "video"}>
        <g fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="1.75" y="4.25" width="8.5" height="7.5" />
          <path d="m10.25 7 4-2.25v6.5l-4-2.25" />
        </g>
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

// The layout icons, each a card: three lines of headline; a big number, an OpenMono 9; a short title over a chart.
function LayoutGlyph(props: { layout: ShareOptions["layout"] }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2.25" y="1.75" width="11.5" height="12.5" />
        <Show when={props.layout === "headline"}>
          <path d="M4.75 5h6.5M4.75 7.75h6.5M4.75 10.5h3.5" />
        </Show>
        <Show when={props.layout === "number"}>
          <text
            x="8"
            y="11.5"
            fill="currentColor"
            stroke="none"
            font-family="OpenMono, ui-monospace, monospace"
            font-size="9.5"
            text-anchor="middle"
          >
            9
          </text>
        </Show>
        <Show when={props.layout === "chart"}>
          <path d="M4.75 4.75h4M5.5 11.75v-2M8 11.75V7.75M10.5 11.75v-3" />
        </Show>
      </g>
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
  if (!ctx) throw new Error(translate(card.locale, "share.error.canvas"))
  drawShareCard(ctx, card, options, Infinity)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error(translate(card.locale, "share.error.image"))
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
  signal: AbortSignal,
) {
  // Created before the first await, while the click still counts, so the context starts running.
  const context = track ? new AudioContext() : undefined
  await loadShareFonts()
  const types = track
    ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    : ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
  const type = types.find((item) => MediaRecorder.isTypeSupported(item))
  if (!type) throw new Error(translate(card.locale, "share.error.video"))
  const canvas = document.createElement("canvas")
  const [width, height] = shareSizes[options.size]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error(translate(card.locale, "share.error.canvas"))
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
      if (time >= length || signal.aborted) return resolve()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  recorder.stop()
  await done
  void context?.close()
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError")
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

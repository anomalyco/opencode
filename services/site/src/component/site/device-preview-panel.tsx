import "./device-preview.css"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js"
import { z } from "zod"
import { freezeEvent, isFrozen, pendingUpdates, setFrozen } from "~/lib/freeze"
import { platformParam, type Platform } from "~/lib/platform"
import { devicePreviewFrame } from "./device-preview"

/** The device preview's panel (see device-preview.tsx), loaded the first time it opens. */

const presets = [
  { id: "se", label: "SE", name: "iPhone SE", w: 375, h: 667, kind: "phone", platform: "ios" },
  { id: "iphone", label: "iPhone", name: "iPhone 15/16", w: 393, h: 852, kind: "phone", platform: "ios" },
  { id: "max", label: "Pro Max", name: "iPhone Pro Max", w: 430, h: 932, kind: "phone", platform: "ios" },
  { id: "pixel", label: "Pixel 8", name: "Pixel 8", w: 412, h: 915, kind: "phone", platform: "android" },
  { id: "mini", label: "iPad mini", name: "iPad mini", w: 768, h: 1024, kind: "tablet", platform: "ios" },
  { id: "ipad", label: "iPad Pro", name: "iPad Pro", w: 1024, h: 1366, kind: "tablet", platform: "ios" },
  { id: "laptop", label: "Laptop", name: "Laptop", w: 1280, h: 800, kind: "desktop", platform: "windows" },
  { id: "macbook", label: "MacBook", name: "MacBook", w: 1440, h: 900, kind: "desktop", platform: "macos" },
  { id: "mbp", label: "16″ MBP", name: '16" MacBook Pro', w: 1728, h: 1117, kind: "desktop", platform: "macos" },
  { id: "desktop", label: "Desktop", name: "Desktop", w: 1920, h: 1080, kind: "desktop", platform: "windows" },
  { id: "wide", label: "Wide", name: "Wide", w: 2560, h: 1440, kind: "desktop", platform: "macos" },
] as const

// The widths where the site's CSS switches layout (its most used max-width and min-width queries).
const breakpoints = [400, 480, 640, 768, 880, 960, 1040, 1280, 1440]

// Side by side: the same page as a phone, a tablet and a desktop.
const trio = [presets[1], presets[4], presets[7]]

const themes = ["site", "light", "dark"] as const
// The OS the frames tell the site they run (lib/platform.ts): each preset's own, or one for all.
const systems = ["auto", "ios", "android", "macos", "windows", "linux"] as const
const systemNames = {
  auto: "Auto",
  ios: "iOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
} as const
const storageKey = "opencode-site-device-preview"
const savedSchema = z.object({
  w: z.number().int().min(240).max(3840),
  h: z.number().int().min(240).max(2880),
  zoom: z.enum(["fit", "100"]),
  theme: z.enum(themes),
  layout: z.enum(["single", "trio"]),
  system: z.enum(systems).default("auto"),
})
const defaults: z.infer<typeof savedSchema> = {
  w: 393,
  h: 852,
  zoom: "fit",
  theme: "site",
  layout: "single",
  system: "auto",
}

// Room around the frame for its bezel and the resize handles.
const pad = 40
const rulerHeight = 22
const labelHeight = 22
const snapDistance = 8
const snapWidths = [...new Set(presets.flatMap((preset) => [preset.w, preset.h]))]

export default function DevicePreviewPanel(props: { onClose: () => void }) {
  const saved = { ...defaults, ...readSaved() }
  const [width, setWidth] = createSignal(saved.w)
  const [height, setHeight] = createSignal(saved.h)
  const [zoom, setZoom] = createSignal(saved.zoom)
  const [theme, setTheme] = createSignal(saved.theme)
  const [layout, setLayout] = createSignal(saved.layout)
  const [system, setSystem] = createSignal(saved.system)
  // Development only: hold Vite's updates and reloads for this page and the frames (lib/freeze.ts).
  const [frozen, setFrozenState] = createSignal(import.meta.env.DEV && isFrozen())
  const [pending, setPending] = createSignal(import.meta.env.DEV ? pendingUpdates() : 0)
  const toggleFreeze = () => {
    if (!import.meta.env.DEV) return
    setFrozen(!frozen())
    setFrozenState(!frozen())
  }
  const [stage, setStage] = createSignal({ w: 0, h: 0 })
  // The scale is held while dragging, so the frame grows under the pointer instead of re-fitting.
  const [dragScale, setDragScale] = createSignal<number>()
  const [path, setPath] = createSignal(withoutPlatform(location.pathname + location.search + location.hash))
  const frames = new Set<HTMLIFrameElement>()
  let root: HTMLDivElement | undefined
  let stageEl: HTMLDivElement | undefined

  const preset = createMemo(() =>
    presets.find((item) => (item.w === width() && item.h === height()) || (item.h === width() && item.w === height())),
  )
  const kind = (w: number, h: number) =>
    presets.find((item) => (item.w === w && item.h === h) || (item.h === w && item.w === h))?.kind ??
    (Math.min(w, h) < 600 ? "phone" : w < 1200 ? "tablet" : "desktop")
  // A custom size counts as an iPhone or iPad below desktop widths, else a Mac.
  const platform = (w: number, h: number): Platform => {
    const chosen = system()
    if (chosen !== "auto") return chosen
    return (
      presets.find((item) => (item.w === w && item.h === h) || (item.h === w && item.w === h))?.platform ??
      (kind(w, h) === "desktop" ? "macos" : "ios")
    )
  }
  const fit = () => Math.min(1, (stage().w - pad * 2) / width(), (stage().h - pad * 2 - rulerHeight) / height())
  const scale = () => dragScale() ?? (zoom() === "fit" ? Math.max(0.1, fit()) : 1)
  const trioScale = () =>
    zoom() === "fit"
      ? Math.max(
          0.1,
          Math.min(
            1,
            (stage().w - pad * 4) / trio.reduce((sum, item) => sum + item.w, 0),
            (stage().h - pad * 2 - labelHeight) / Math.max(...trio.map((item) => item.h)),
          ),
        )
      : 1

  createEffect(() =>
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        w: width(),
        h: height(),
        zoom: zoom(),
        theme: theme(),
        layout: layout(),
        system: system(),
      }),
    ),
  )

  const choose = (item: (typeof presets)[number]) => {
    setWidth(item.w)
    setHeight(item.h)
  }
  const rotate = () => {
    const w = width()
    setWidth(height())
    setHeight(w)
  }

  onMount(() => {
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = "hidden"
    root?.querySelector<HTMLElement>('[data-slot="presets"] [aria-pressed="true"], [data-slot="close"]')?.focus()

    const observer = new ResizeObserver(([entry]) =>
      setStage({ w: entry.contentRect.width, h: entry.contentRect.height }),
    )
    if (stageEl) observer.observe(stageEl)

    // Escape closes the preview before the page's own handlers (Design mode turns off on Escape).
    const key = (event: KeyboardEvent) => {
      if (event.key === "F" && !typingIn(event) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        return toggleFreeze()
      }
      if (event.key !== "Escape") return
      event.stopPropagation()
      props.onClose()
    }
    window.addEventListener("keydown", key, true)
    const held = (event: Event) => setPending((event as CustomEvent<number>).detail)
    window.addEventListener(freezeEvent, held)

    // Same-origin frames: follow each one's path (the router changes it without an event), keep
    // its theme, and in the side-by-side layout carry a navigation in one frame over to the others.
    const holds = new Map<HTMLIFrameElement, { path: string; until: number }>()
    const last = new Map<HTMLIFrameElement, string>()
    const timer = setInterval(() => {
      frames.forEach((frame) => {
        const doc = frameDocument(frame)
        if (!doc) return
        const site = doc.querySelector("[data-site]")
        const wanted = theme() === "site" ? (localStorage.getItem("opencode-theme") ?? "system") : theme()
        if (site && site.getAttribute("data-theme") !== wanted) site.setAttribute("data-theme", wanted)

        const current = withoutPlatform(doc.location.pathname + doc.location.search + doc.location.hash)
        const hold = holds.get(frame)
        if (hold && hold.path !== current && hold.until > Date.now()) return
        holds.delete(frame)
        if (last.get(frame) === current) return
        last.set(frame, current)
        setPath(current)
        ;[...frames]
          .filter((other) => other !== frame && last.get(other) !== current)
          .forEach((other) => {
            const otherDoc = frameDocument(other)
            if (!otherDoc?.body) return
            last.set(other, current)
            holds.set(other, { path: current, until: Date.now() + 2000 })
            // A link click, so the page's router changes page in place.
            const link = Object.assign(otherDoc.createElement("a"), { href: current })
            otherDoc.body.append(link)
            link.click()
            link.remove()
          })
      })
    }, 200)

    onCleanup(() => {
      document.documentElement.style.overflow = overflow
      observer.disconnect()
      window.removeEventListener("keydown", key, true)
      window.removeEventListener(freezeEvent, held)
      // Closing the preview unfreezes the page, applying what was held.
      if (frozen()) setFrozen(false)
      clearInterval(timer)
    })
  })

  // Runs on every load of a frame's document: its keys, outside links and scroll sync.
  const attach = (frame: HTMLIFrameElement) => {
    const win = frame.contentWindow
    const doc = frameDocument(frame)
    if (!win || !doc) return
    win.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return
      const plain = !typingIn(event) && !event.metaKey && !event.ctrlKey && !event.altKey
      if (event.key === "F" && plain) return toggleFreeze()
      if (event.key === "Escape" || (event.key === "P" && plain)) props.onClose()
    })
    // Links to other sites open in a tab; this site's links stay in the frame.
    doc.addEventListener(
      "click",
      (event) => {
        const link = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]")
        if (!link || link.origin === win.location.origin) return
        event.preventDefault()
        window.open(link.href, "_blank", "noopener")
      },
      true,
    )
    win.addEventListener("scroll", () => syncScroll(frame), { passive: true })
  }

  // Scrolling one frame of the side-by-side layout scrolls the others to the same point.
  const quiet = new Map<HTMLIFrameElement, number>()
  const syncScroll = (source: HTMLIFrameElement) => {
    if (layout() !== "trio" || (quiet.get(source) ?? 0) > Date.now()) return
    const doc = frameDocument(source)
    if (!doc) return
    const max = doc.documentElement.scrollHeight - doc.documentElement.clientHeight
    const ratio = max > 0 ? doc.documentElement.scrollTop / max : 0
    ;[...frames]
      .filter((frame) => frame !== source)
      .forEach((frame) => {
        const other = frameDocument(frame)
        if (!other) return
        quiet.set(frame, Date.now() + 120)
        other.documentElement.scrollTop =
          ratio * (other.documentElement.scrollHeight - other.documentElement.clientHeight)
      })
  }

  const register = (frame: HTMLIFrameElement) => {
    frames.add(frame)
    onCleanup(() => frames.delete(frame))
  }

  // The resize handles: the frame is centred, so a horizontal drag moves both edges.
  const resize = (axis: "x" | "y" | "xy") => (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const from = { x: event.clientX, y: event.clientY, w: width(), h: height(), s: scale() }
    setDragScale(from.s)
    const move = (moved: PointerEvent) => {
      if (axis !== "y") setWidth(snap(clamp(from.w + ((moved.clientX - from.x) * 2) / from.s, 240, 3840), snapWidths))
      if (axis !== "x") setHeight(snap(clamp(from.h + (moved.clientY - from.y) / from.s, 240, 2880), snapWidths))
    }
    const end = () => {
      setDragScale(undefined)
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }
  const nudge = (axis: "x" | "y" | "xy") => (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0
    if ((axis === "x" && !dx) || (axis === "y" && !dy) || (!dx && !dy)) return
    event.preventDefault()
    if (axis !== "y") setWidth((w) => clamp(w + dx, 240, 3840))
    if (axis !== "x") setHeight((h) => clamp(h + dy, 240, 2880))
  }

  const readout = () =>
    layout() === "trio"
      ? `${trio.map((item) => `${item.w}`).join(" · ")} · ${Math.round(trioScale() * 100)}%`
      : `${width()} × ${height()} · ${Math.round(scale() * 100)}%`

  return (
    <div
      ref={root}
      data-component="device-preview"
      data-dragging={dragScale() === undefined ? undefined : ""}
      role="dialog"
      aria-modal="true"
      aria-label="Device preview"
    >
      <div data-slot="toolbar" role="toolbar" aria-label="Device preview controls">
        <div data-slot="row">
          <button type="button" data-slot="close" aria-label="Close device preview (Esc)" onClick={props.onClose}>
            <Icon d="M4 4l8 8M12 4l-8 8" />
          </button>
          <button
            type="button"
            aria-label="Back"
            title="Back"
            onClick={() => frames.forEach((frame) => frameDocument(frame)?.defaultView?.history.back())}
          >
            <Icon d="M10 3L5 8l5 5" />
          </button>
          <span data-slot="path" title={path()}>
            {path()}
          </span>
          <a href={path()} target="_blank" rel="noopener" aria-label="Open in a new tab" title="Open in a new tab">
            <Icon d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" />
          </a>
          <Show when={import.meta.env.DEV}>
            <button
              type="button"
              data-slot="freeze"
              aria-pressed={frozen() ? "true" : "false"}
              title="Hold hot updates and reloads (⇧F)"
              onClick={toggleFreeze}
            >
              <Icon d="M8 2v12M3 5l10 6M13 5L3 11" />
              Freeze
            </button>
            <Show when={frozen()}>
              <span data-slot="frozen" role="status">
                Frozen · {pending() === 1 ? "1 update" : `${pending()} updates`} waiting
                <button type="button" onClick={() => location.reload()}>
                  Refresh now
                </button>
              </span>
            </Show>
            {/* The stable review server (review-build.sh in the worktree root), when it runs. */}
            <a
              data-slot="review"
              href={`${location.protocol}//${location.hostname}:3012${path()}`}
              target="_blank"
              rel="noopener"
              title="Open this page on the review server (:3012)"
            >
              :3012
            </a>
          </Show>
          <span data-slot="spacer" />
          <output data-slot="readout" aria-live="polite">
            <Show when={layout() === "single" && preset()}>{(item) => <b>{item().name}</b>}</Show>
            {readout()}
          </output>
          <label data-slot="system">
            <span>Device OS</span>
            <select
              value={system()}
              onChange={(event) => setSystem(event.currentTarget.value as (typeof systems)[number])}
            >
              <For each={systems}>
                {(option) => (
                  <option value={option}>
                    {option === "auto" && layout() === "single"
                      ? `Auto (${systemNames[platform(width(), height())]})`
                      : systemNames[option]}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Segmented
            label="Frame theme"
            options={themes}
            value={theme()}
            onChange={setTheme}
            names={{ site: "Site", light: "Light", dark: "Dark" }}
          />
          <Segmented
            label="Zoom"
            options={["fit", "100"] as const}
            value={zoom()}
            onChange={setZoom}
            names={{ fit: "Fit", "100": "100%" }}
          />
          <Segmented
            label="Layout"
            options={["single", "trio"] as const}
            value={layout()}
            onChange={setLayout}
            names={{ single: "One", trio: "Side by side" }}
          />
        </div>
        <Show when={layout() === "single"}>
          <div data-slot="row">
            <div data-slot="presets" role="group" aria-label="Device sizes">
              <For each={presets}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={preset()?.id === item.id ? "true" : "false"}
                    title={`${item.name} · ${item.w} × ${item.h}`}
                    onClick={() => choose(item)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <button
              type="button"
              data-slot="rotate"
              aria-label={width() > height() ? "Rotate to portrait" : "Rotate to landscape"}
              title="Rotate"
              onClick={rotate}
            >
              <Icon d="M3 8a5 5 0 0 1 9-3M13 3v3h-3M13 8a5 5 0 0 1-9 3M3 13v-3h3" />
              {width() > height() ? "Landscape" : "Portrait"}
            </button>
          </div>
        </Show>
      </div>

      <div ref={stageEl} data-slot="stage" data-zoom={zoom()} data-layout={layout()}>
        <Show
          when={layout() === "single"}
          fallback={
            <div data-slot="trio">
              <Index each={trio}>
                {(item) => (
                  <figure>
                    <figcaption>
                      {item().name} · {item().w} × {item().h}
                    </figcaption>
                    <Device
                      w={item().w}
                      h={item().h}
                      scale={trioScale()}
                      kind={kind(item().w, item().h)}
                      platform={platform(item().w, item().h)}
                      src={untrack(path)}
                      label={item().name}
                      frame={register}
                      onLoad={attach}
                    />
                  </figure>
                )}
              </Index>
            </div>
          }
        >
          <div data-slot="single">
            <Device
              w={width()}
              h={height()}
              scale={scale()}
              kind={kind(width(), height())}
              platform={platform(width(), height())}
              src={untrack(path)}
              label={`${width()} × ${height()}`}
              frame={register}
              onLoad={attach}
              ruler={
                <div
                  data-slot="ruler"
                  aria-hidden="true"
                  style={{
                    width: `${Math.min(Math.max(width(), 1440) * scale(), (stage().w + width() * scale()) / 2 - pad)}px`,
                    "--step": `${100 * scale()}px`,
                  }}
                >
                  <For each={breakpoints}>
                    {(point) => (
                      <span
                        data-slot="tick"
                        data-passed={point <= width() ? "" : undefined}
                        style={{ left: `${point * scale()}px` }}
                      >
                        {point}
                      </span>
                    )}
                  </For>
                </div>
              }
            >
              <For each={["x", "y", "xy"] as const}>
                {(axis) => (
                  <div
                    data-slot="handle"
                    data-axis={axis}
                    role="slider"
                    tabIndex={0}
                    aria-label={axis === "x" ? "Width" : axis === "y" ? "Height" : "Width and height"}
                    aria-valuenow={axis === "y" ? height() : width()}
                    aria-valuemin={240}
                    aria-valuemax={axis === "y" ? 2880 : 3840}
                    aria-valuetext={`${width()} × ${height()}`}
                    onPointerDown={resize(axis)}
                    onKeyDown={nudge(axis)}
                  />
                )}
              </For>
            </Device>
          </div>
        </Show>
      </div>
    </div>
  )
}

function Device(props: {
  w: number
  h: number
  scale: number
  kind: string
  platform: Platform
  src: string
  label: string
  frame: (frame: HTMLIFrameElement) => void
  onLoad: (frame: HTMLIFrameElement) => void
  ruler?: JSX.Element
  children?: JSX.Element
}) {
  let iframe: HTMLIFrameElement | undefined
  // The server renders the platform's copy from the URL parameter, so a new platform reloads the
  // frame at its current page. Inside, the frame attribute keeps it after the page changes in place.
  createEffect(
    on(
      () => props.platform,
      (platform) => {
        const doc = iframe && frameDocument(iframe)
        if (doc)
          doc.location.replace(withPlatform(doc.location.pathname + doc.location.search + doc.location.hash, platform))
      },
      { defer: true },
    ),
  )
  return (
    <div
      data-slot="device"
      data-kind={props.kind}
      style={{ width: `${props.w * props.scale}px`, height: `${props.h * props.scale}px`, "--s": props.scale }}
    >
      {props.ruler}
      <div data-slot="clip">
        <div
          data-slot="screen"
          style={{ width: `${props.w}px`, height: `${props.h}px`, transform: `scale(${props.scale})` }}
        >
          {/* The src is read once: the frame then navigates on its own. data-device-preview-os is
              lib/platform.ts's platformFrameAttribute. */}
          <iframe
            ref={(frame) => {
              iframe = frame
              props.frame(frame)
            }}
            src={withPlatform(
              props.src,
              untrack(() => props.platform),
            )}
            data-device-preview-os={props.platform}
            title={`Preview at ${props.label}`}
            {...{ [devicePreviewFrame]: "" }}
            onLoad={(event) => props.onLoad(event.currentTarget)}
          />
        </div>
      </div>
      {props.children}
    </div>
  )
}

function Segmented<T extends string>(props: {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  names: Record<T, string>
}) {
  return (
    <div data-slot="segmented" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.value === option ? "true" : "false"}
            onClick={() => props.onChange(option)}
          >
            {props.names[option]}
          </button>
        )}
      </For>
    </div>
  )
}

function Icon(props: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d={props.d}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)))
}

function snap(value: number, targets: number[]) {
  return targets.find((target) => Math.abs(target - value) <= snapDistance) ?? value
}

function typingIn(event: KeyboardEvent) {
  return !!(event.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")
}

function withPlatform(path: string, platform: Platform) {
  const url = new URL(path, location.origin)
  url.searchParams.set(platformParam, platform)
  return url.pathname + url.search + url.hash
}

// The parameter stays out of the path shown, opened in a tab or carried to the other frames.
function withoutPlatform(path: string) {
  const url = new URL(path, location.origin)
  url.searchParams.delete(platformParam)
  return url.pathname + url.search + url.hash
}

// A frame that has left the site has no readable document, and one still loading has about:blank.
function frameDocument(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument
  return doc && doc.location.protocol !== "about:" ? doc : undefined
}

function readSaved() {
  try {
    const parsed = savedSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? "null"))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

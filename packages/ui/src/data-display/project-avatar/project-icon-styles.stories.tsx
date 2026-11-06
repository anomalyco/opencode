import { createEffect, createMemo, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon as Glyph } from "../../icons/icon/icon"
import oc2 from "../../theme/themes/oc-2.json"
import type { DesktopTheme } from "../../theme/types"
import { resolveThemeV2, themeV2ToCss } from "../../theme/v2/resolve"
import { PROJECT_ICON_FAMILIES, PROJECT_ICON_STYLES, projectIconStyle, type ProjectIconStyle } from "./procedural"
import "./project-avatar.css"

const docs = `### Overview
Candidate procedural styles for the generated default project avatar, next to James's mesh. Each style resolves its
params once from a key, like the mesh, and draws on a 2D canvas clipped to the avatar's rounded tile.

### Gallery
- Rows are grouped by family; columns are fictional project names at 32, 20 and 16 px, then a large preview.
- The top shows the style in context, on the dark and light themes, at the sizes the app uses: the sidebar's session
  tabs, the tab strip, the session header, Home's projects, the inbox (all 16 px) and project settings (32 px).
- Hover a row to show its style in context; click an icon to keep it there. Hover an icon to play its animation (off
  with reduced motion). Click a row's star to keep it; stars persist in this browser.

### Controls
- \`style\` and \`family\`: one style, one family or all. \`starred\`: starred styles only.
- \`name\`: a seed of your own, shown in the first column. \`size\`: the large preview.
- \`surface\`: dark or light gallery. \`animate\`: hover animation.
`

const NAMES = [
  "atlas",
  "quill",
  "harbor-api",
  "nimbus",
  "copperleaf",
  "tern",
  "lumen-ui",
  "basalt",
  "orchard",
  "vesper",
  "kiln",
  "driftwood",
]

// What each fictional project is doing in the mock app: its session title and Home's waiting and running counts.
const SESSIONS = [
  "Fix flaky auth test",
  "Draft release notes",
  "Rate limit the webhooks",
  "Port charts to canvas",
  "Tidy the onboarding copy",
  "Bump the SDK",
  "Dark mode for settings",
  "Investigate memory leak",
  "Add CSV export",
  "Refactor the queue",
  "Kiln firing schedule",
  "Sync offline edits",
]

const SIZES = [32, 20, 16]

const STARS_KEY = "opencode.lab.project-icon-styles.starred"

const SURFACES = {
  dark: {
    background: "#141414",
    text: "#ededed",
    muted: "#8a8a8a",
    hairline: "rgba(255, 255, 255, 0.08)",
    ring: "rgba(255, 255, 255, 0.85)",
  },
  light: {
    background: "#fafafa",
    text: "#171717",
    muted: "#737373",
    hairline: "rgba(0, 0, 0, 0.08)",
    ring: "rgba(0, 0, 0, 0.8)",
  },
}

// The default theme's tokens for each scheme, so the in-context mocks show both at once whatever the lab shows.
const THEMES = (() => {
  const theme = resolveThemeV2(oc2 as DesktopTheme)

  return { dark: themeV2ToCss(theme.dark), light: themeV2ToCss(theme.light) }
})()

type Args = {
  style: string
  family: string
  starred: boolean
  name: string
  size: number
  surface: string
  animate: boolean
}

export default {
  title: "UI/ProjectIconStyles",
  id: "ui-project-icon-styles",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    style: {
      control: "select",
      options: ["all", ...PROJECT_ICON_STYLES.map((style) => style.id)],
    },
    family: {
      control: "select",
      options: ["all", ...PROJECT_ICON_FAMILIES],
    },
    size: {
      control: { type: "range", min: 48, max: 160, step: 8 },
    },
    surface: {
      control: "select",
      options: ["dark", "light"],
    },
  },
  args: {
    style: "all",
    family: "all",
    starred: false,
    name: "",
    size: 88,
    surface: "dark",
    animate: true,
  },
}

export const Gallery = {
  render: (args: Args) => <GalleryView args={args} />,
}

export const ContactSheet = {
  render: (args: Args) => <ContactSheetView args={args} />,
}

function GalleryView(props: { args: Args }) {
  const surface = () => (props.args.surface === "light" ? SURFACES.light : SURFACES.dark)
  const names = () => (props.args.name ? [props.args.name, ...NAMES.slice(1)] : NAMES)
  const [state, setState] = createStore({ style: "mesh", name: NAMES[0], hover: "", starred: readStars() })

  createEffect(on(() => state.starred.length, () => writeStars(state.starred), { defer: true }))

  const styles = createMemo(() =>
    PROJECT_ICON_STYLES.filter(
      (style) =>
        (props.args.style === "all" || style.id === props.args.style) &&
        (props.args.family === "all" || style.family === props.args.family) &&
        (!props.args.starred || state.starred.includes(style.id)),
    ),
  )

  const families = createMemo(() =>
    PROJECT_ICON_FAMILIES.map((family) => ({
      family,
      styles: styles().filter((style) => style.family === family),
    })).filter((group) => group.styles.length),
  )

  // A hovered row previews its style; leaving the gallery returns to the chosen one.
  const spotlight = () => projectIconStyle(state.hover || state.style)
  const starred = (style: ProjectIconStyle) => state.starred.includes(style.id)

  const toggleStar = (style: ProjectIconStyle) =>
    setState("starred", (list) => (list.includes(style.id) ? list.filter((id) => id !== style.id) : [...list, style.id]))

  createEffect(
    on(
      () => props.args.name,
      (name) => name && setState("name", name),
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.args.style,
      (style) => style !== "all" && setState("style", style),
      { defer: true },
    ),
  )

  const isSelected = (style: ProjectIconStyle, name: string) => state.style === style.id && state.name === name

  // Fixed columns: a label, one 32 + 20 + 16 px trio per name, then the large preview.
  const row = () => ({
    display: "grid",
    "grid-template-columns": `200px repeat(${names().length}, 80px) 48px`,
    "column-gap": "24px",
    "align-items": "center",
  })

  const tile = (style: ProjectIconStyle, name: string, size: number) => (
    <Tile
      style={style}
      name={name}
      size={size}
      animate={props.args.animate}
      selected={isSelected(style, name)}
      ring={surface().ring}
      onSelect={() => setState({ style: style.id, name, hover: "" })}
    />
  )

  return (
    <div
      style={{
        // The lab's canvas is a flex column: without this the gallery shrinks to its height and the header stops sticking.
        "flex-shrink": 0,
        "min-height": "100%",
        "min-width": "max-content",
        padding: "0 24px 24px",
        background: surface().background,
        color: surface().text,
        "font-size": "13px",
        "line-height": "16px",
      }}
    >
      <div style={{ position: "sticky", top: "0", "z-index": 1, background: surface().background }}>
        <div style={{ display: "flex", gap: "24px", "align-items": "flex-start", padding: "24px 0 16px" }}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px", width: "200px", "flex-shrink": 0 }}>
            <Icon style={spotlight()} name={state.name} size={props.args.size} animate={props.args.animate} />
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <div style={{ display: "flex", gap: "6px", "align-items": "center", "font-weight": 500 }}>
                <span>{spotlight().name}</span>
                <Star on={starred(spotlight())} muted={surface().muted} onToggle={() => toggleStar(spotlight())} />
              </div>
              <div style={{ color: surface().muted, "font-size": "12px" }}>
                {spotlight().family} · {state.name}
              </div>
              <div style={{ color: surface().muted, "font-size": "12px" }}>{spotlight().label}</div>
              <div style={{ color: surface().muted, "font-size": "12px", "padding-top": "8px" }}>
                In context: 16 px in the tab strip, the sidebar's tabs, the session header, Home's projects and the
                inbox; 32 px in project settings.
              </div>
            </div>
          </div>
          <InContext style={spotlight()} scheme="dark" animate={props.args.animate} />
          <InContext style={spotlight()} scheme="light" animate={props.args.animate} />
        </div>
        <div style={{ ...row(), color: surface().muted, "font-size": "12px", "padding-bottom": "8px" }}>
          <div>
            {styles().length} styles
            <Show when={state.starred.length}> · {state.starred.length} starred</Show>
          </div>
          <For each={names()}>
            {(name) => (
              <div style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{name}</div>
            )}
          </For>
        </div>
      </div>
      <div onPointerLeave={() => setState("hover", "")}>
        <Show
          when={families().length}
          fallback={
            <div style={{ padding: "24px 0", color: surface().muted }}>
              No styles match. Star a style with the star beside its name.
            </div>
          }
        >
          <For each={families()}>
            {(group) => (
              <section>
                <div
                  style={{
                    padding: "24px 0 8px",
                    color: surface().muted,
                    "font-size": "11px",
                    "font-weight": 500,
                    "letter-spacing": "0.06em",
                    "text-transform": "uppercase",
                    "border-bottom": `1px solid ${surface().hairline}`,
                  }}
                >
                  {group.family} · {group.styles.length}
                </div>
                <For each={group.styles}>
                  {(style) => (
                    <div
                      data-style={style.id}
                      onPointerEnter={() => setState("hover", style.id)}
                      style={{
                        ...row(),
                        padding: "12px 0",
                        "border-top": `1px solid ${surface().hairline}`,
                        background: state.hover === style.id ? surface().hairline : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
                        <Star on={starred(style)} muted={surface().muted} onToggle={() => toggleStar(style)} />
                        <button
                          type="button"
                          onClick={() => setState({ style: style.id, hover: "" })}
                          style={{ ...reset, padding: "0", "text-align": "start", flex: 1 }}
                        >
                          <div style={{ "font-weight": 500 }}>{style.name}</div>
                          <div style={{ color: surface().muted, "font-size": "12px", "padding-top": "2px" }}>
                            {style.label}
                          </div>
                        </button>
                      </div>
                      <For each={names()}>
                        {(name) => (
                          <div style={{ display: "flex", gap: "6px", "align-items": "flex-end" }}>
                            <For each={SIZES}>{(size) => tile(style, name, size)}</For>
                          </div>
                        )}
                      </For>
                      {tile(style, state.name, 48)}
                    </div>
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

// A mock of the app's chrome built from the same layout values as the real surfaces (tab-nav.tsx, home/start,
// session-identity-header.tsx, inbox.tsx and settings/workspaces/project.tsx), with the style's icons for every project.
function InContext(props: { style: ProjectIconStyle; scheme: "dark" | "light"; animate: boolean }) {
  const avatar = (name: string, size = 16) => (
    <Icon style={props.style} name={name} size={size} animate={props.animate} />
  )

  const text = (color: string, extra: JSX.CSSProperties = {}) => ({
    color: `var(--v2-text-text-${color})`,
    "font-size": "13px",
    "line-height": "16px",
    "white-space": "nowrap" as const,
    overflow: "hidden",
    "text-overflow": "ellipsis",
    ...extra,
  })

  return (
    <div
      data-scheme={props.scheme}
      style={`${THEMES[props.scheme]} color-scheme: ${props.scheme}; flex-shrink: 0;`}
    >
      <div
        style={{
          width: "480px",
          "border-radius": "10px",
          overflow: "hidden",
          background: "var(--v2-background-bg-deep)",
          "box-shadow": "0 0 0 0.5px var(--v2-border-border-base), 0 8px 24px rgba(0, 0, 0, 0.18)",
          "font-size": "13px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "4px", height: "36px", padding: "0 8px" }}>
          <div style={{ display: "flex", gap: "6px", padding: "0 8px 0 4px" }}>
            <For each={[0, 1, 2]}>
              {() => (
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    "border-radius": "9999px",
                    background: "var(--v2-background-bg-layer-03)",
                  }}
                />
              )}
            </For>
          </div>
          <For each={[11, 3, 1, 6]}>
            {(project, i) => (
              <Tab active={i() === 1} width="96px">
                {avatar(NAMES[project])}
                <span style={text(i() === 1 ? "base" : "faint", { "font-weight": 500 })}>{SESSIONS[project]}</span>
              </Tab>
            )}
          </For>
        </div>
        <div style={{ display: "grid", "grid-template-columns": "168px 1fr", height: "264px" }}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "2px", padding: "4px 8px", overflow: "hidden" }}>
            <For each={["Home", "Search sessions"]}>
              {(label, i) => (
                <div style={{ display: "flex", "align-items": "center", gap: "6px", height: "28px", padding: "0 6px" }}>
                  <Glyph
                    name={i() === 0 ? "grid-plus" : "magnifying-glass"}
                    size="small"
                    style={{ color: "var(--v2-icon-icon-muted)", width: "16px" }}
                  />
                  <span style={text("muted")}>{label}</span>
                </div>
              )}
            </For>
            <div style={{ height: "8px" }} />
            <For each={NAMES.slice(0, 6)}>
              {(name, i) => (
                <Tab active={i() === 3}>
                  {avatar(name)}
                  <span style={text(i() === 3 ? "base" : "faint", { "font-weight": 500, "text-transform": "uppercase" })}>
                    {name}
                  </span>
                </Tab>
              )}
            </For>
          </div>
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "8px",
              padding: "8px 12px",
              background: "var(--v2-background-bg-base)",
              "border-top-left-radius": "8px",
              "box-shadow": "0 0 0 0.5px var(--v2-border-border-muted)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", "align-items": "center", gap: "6px", height: "24px", padding: "0 4px" }}>
              {avatar(NAMES[3])}
              <span style={text("muted", { "font-weight": 440 })}>{NAMES[3]}</span>
              <span style={text("faint", { "font-size": "12px" })}>/ {SESSIONS[3]}</span>
            </div>
            <div style={{ display: "flex", "flex-direction": "column" }}>
              <div style={{ ...text("muted", { "font-size": "12px", "font-weight": 500 }), padding: "6px 8px" }}>
                Projects
              </div>
              <For each={NAMES.slice(4, 8)}>
                {(name, i) => (
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      height: "32px",
                      padding: "0 8px",
                      "border-radius": "6px",
                      background: i() === 0 ? "var(--v2-overlay-simple-overlay-hover)" : "transparent",
                    }}
                  >
                    {avatar(name)}
                    <span style={{ ...text("base"), flex: 1 }}>{name}</span>
                    <Show when={i() < 3}>
                      <span
                        style={text("faint", {
                          "font-size": "12px",
                          color: i() === 0 ? "var(--v2-state-fg-warning)" : "var(--v2-text-text-faint)",
                        })}
                      >
                        {[2, 1, 3][i()]}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <For each={NAMES.slice(8, 10)}>
              {(name, i) => (
                <div style={{ display: "flex", "align-items": "center", gap: "6px", height: "16px", padding: "0 8px" }}>
                  {avatar(name)}
                  <span style={{ ...text("faint", { "font-size": "12px" }), flex: 1 }}>{name}</span>
                  <span style={text("faint", { "font-size": "12px" })}>{["3m", "1h"][i()]}</span>
                </div>
              )}
            </For>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "12px",
            padding: "12px 16px",
            background: "var(--v2-background-bg-base)",
            "border-top": "0.5px solid var(--v2-border-border-muted)",
          }}
        >
          {avatar(NAMES[10], 32)}
          <div style={{ display: "flex", "flex-direction": "column", gap: "2px", "min-width": 0 }}>
            <span style={text("base", { "font-size": "15px", "line-height": "20px", "font-weight": 530 })}>
              {NAMES[10]}
            </span>
            <span style={text("faint", { "font-size": "12px" })}>Project settings</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// The tab-nav tab: 28 px tall, 6 px radius and padding, a 16 px avatar slot, pressed overlay when active.
function Tab(props: { active: boolean; width?: string; children: JSX.Element }) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "6px",
        height: "28px",
        width: props.width,
        "min-width": 0,
        padding: "0 6px",
        "border-radius": "6px",
        background: props.active ? "var(--v2-overlay-simple-overlay-pressed)" : "transparent",
        "flex-shrink": props.width ? 1 : 0,
      }}
    >
      {props.children}
    </div>
  )
}

function Star(props: { on: boolean; muted: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.on ? "Unstar" : "Star"}
      aria-pressed={props.on}
      onClick={(event) => {
        event.stopPropagation()
        props.onToggle()
      }}
      style={{ ...reset, padding: "0", width: "16px", height: "16px", "flex-shrink": 0 }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
          fill={props.on ? "#f5b301" : "none"}
          stroke={props.on ? "#f5b301" : props.muted}
          stroke-width="1.2"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  )
}

function readStars(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STARS_KEY) ?? "[]")

    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

function writeStars(ids: readonly string[]) {
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(ids))
  } catch {}
}

// Every style × six names at 32, 20 and 16 px, in three columns: the proof still for review.
function ContactSheetView(props: { args: Args }) {
  const surface = () => (props.args.surface === "light" ? SURFACES.light : SURFACES.dark)
  const names = NAMES.slice(0, 6)
  const third = Math.ceil(PROJECT_ICON_STYLES.length / 3)
  const columns = [0, 1, 2].map((i) => PROJECT_ICON_STYLES.slice(i * third, (i + 1) * third))

  return (
    <div
      data-slot="contact-sheet"
      style={{
        display: "inline-flex",
        gap: "48px",
        padding: "24px",
        background: surface().background,
        color: surface().text,
        "font-size": "12px",
        "line-height": "16px",
      }}
    >
      <For each={columns}>
        {(column) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <For each={column}>
              {(style) => (
                <div style={{ display: "flex", "align-items": "flex-end", gap: "20px" }}>
                  <div style={{ width: "88px", "align-self": "center", "white-space": "nowrap" }}>{style.name}</div>
                  <For each={SIZES}>
                    {(size) => (
                      <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
                        <For each={names}>
                          {(name) => <Icon style={style} name={name} size={size} animate={props.args.animate} />}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}

const reset = {
  background: "none",
  border: "0",
  margin: "0",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
}

function Tile(props: {
  style: ProjectIconStyle
  name: string
  size: number
  animate: boolean
  selected: boolean
  ring: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      title={`${props.style.name} · ${props.name}`}
      onClick={props.onSelect}
      style={{
        ...reset,
        padding: "0",
        display: "block",
        "border-radius": `${Math.max(4, props.size * 0.22 + 2)}px`,
        outline: props.selected ? `1.5px solid ${props.ring}` : "none",
        "outline-offset": "2px",
      }}
    >
      <Icon style={props.style} name={props.name} size={props.size} animate={props.animate} />
    </button>
  )
}

// The avatar's own markup and styles, so each style is clipped exactly as ProjectAvatar clips the mesh.
function Icon(props: { style: ProjectIconStyle; name: string; size: number; animate: boolean }) {
  let canvas!: HTMLCanvasElement

  onMount(() => {
    const icon = () => props.style.generate(props.name)
    let frame = 0
    let time = 0
    let hovering = false
    let last = 0

    const paint = (seconds: number) => {
      const px = Math.max(1, Math.round(props.size * (window.devicePixelRatio || 1)))

      if (canvas.width !== px) canvas.width = canvas.height = px
      const ctx = canvas.getContext("2d")

      if (!ctx) return

      if (seconds > 0) return props.style.draw(ctx, px, icon(), seconds)
      ctx.clearRect(0, 0, px, px)
      ctx.drawImage(still(props.style, props.name, px), 0, 0)
    }

    // As in the app's avatars: play while hovered, then ease back to the static frame and stop.
    const tick = (now: number) => {
      const seconds = Math.min((now - last) / 1000, 0.1)
      last = now
      time = hovering ? time + seconds : time * Math.pow(0.002, seconds)

      if (!hovering && time < 0.01) {
        time = 0
        frame = 0
        paint(0)

        return
      }

      paint(time)
      frame = requestAnimationFrame(tick)
    }

    const enter = () => {
      if (!props.animate || !props.style.animated || matchMedia("(prefers-reduced-motion: reduce)").matches) return
      hovering = true

      if (frame) return
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }

    const leave = () => (hovering = false)
    const target = canvas.closest("button") ?? canvas

    target.addEventListener("pointerenter", enter)
    target.addEventListener("pointerleave", leave)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      target.removeEventListener("pointerenter", enter)
      target.removeEventListener("pointerleave", leave)
    })
    createEffect(() => {
      props.style
      props.name
      props.size

      if (!frame) paint(0)
    })
  })

  return (
    <div data-component="project-avatar-v2" style={{ width: `${props.size}px`, height: `${props.size}px` }}>
      <div data-slot="project-avatar-surface" data-generated="">
        <canvas ref={canvas} data-slot="project-avatar-generated" aria-hidden="true" />
      </div>
    </div>
  )
}

const stills = new Map<string, HTMLCanvasElement>()

function still(style: ProjectIconStyle, name: string, px: number) {
  const key = `${style.id}|${name}|${px}`
  const cached = stills.get(key)

  if (cached) return cached

  if (stills.size > 4096) stills.clear()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = px
  const ctx = canvas.getContext("2d")

  if (ctx) style.draw(ctx, px, style.generate(name), 0)
  stills.set(key, canvas)

  return canvas
}

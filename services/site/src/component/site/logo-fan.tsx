import { useI18n } from "~/context/i18n"
import "./logo-fan.css"
import { A } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useLanguage } from "~/context/language"
import { brandAssets } from "~/lib/media"
import { logoVariantSvgs } from "./logo-variants"
import { pressIcons } from "./press-icons"
import { siteSettings } from "./settings"

type Position = { x: number; y: number }

// Each item drops a little further than the one above it (12px, then 6px more per item, up to
// 42px), so the column cascades without any item travelling far. Items also start a touch small
// and turned, and settle square.
const drop = (index: number) => Math.min(12 + index * 6, 42)
const start = (index: number) => `translateY(-${drop(index)}px) rotate(-1deg) scale(0.97)`
const rest = "translateY(0px) rotate(0deg) scale(1)"
const stagger = 32

// A tight damped spring (about 7% overshoot, no visible second settle), sampled for linear().
const spring = `linear(${Array.from({ length: 48 }, (_, index) => {
  const t = index / 47
  const damping = 0.65
  const frequency = 11
  const damped = frequency * Math.sqrt(1 - damping * damping)
  const value =
    1 -
    Math.exp(-damping * frequency * t) *
      (Math.cos(damped * t) + ((damping * frequency) / damped) * Math.sin(damped * t))
  return index === 47 ? "1" : value.toFixed(4)
}).join(", ")})`

// The fan's motion, shared with the section menus' fan style (docs-lockup.tsx).
export const fanMotion = { start, rest, stagger, spring }

/**
 * The logo menu's fan option: like a Dock stack in Fan view, each brand asset springs out of the
 * logo, one after another, into a straight column of previews, each with its label beside it. The
 * light files come first, then the dark ones, each default then simple. It stays mounted while
 * it closes, so the items can fold back into the logo before it goes.
 */
export function LogoFan(props: { position?: Position; onSelect: () => void }) {
  const i18n = useI18n()
  const language = useLanguage()
  const [closed, setClosed] = createSignal(true)
  // The last position stays while the fan closes.
  const shown = createMemo<Position | undefined>((previous) => props.position ?? (closed() ? undefined : previous))
  createEffect(() => {
    if (props.position) setClosed(false)
  })

  // Transparent and solid only: on a plain light or dark background the transparent files look
  // the same as the standard ones, which stay in the zip and on the Brand page.
  // All the light files first, then the dark ones.
  const files = (["light", "dark"] as const).flatMap((tone) =>
    (["transparent", "solid"] as const).flatMap((style) =>
      (["logo", "wordmark"] as const).map((kind) => ({
        kind,
        tone,
        style,
        // The transparent files are the default logos; the solid ones are labelled "simple".
        name: `${kind === "logo" ? "Logo" : "Wordmark"}${style === "solid" ? " (simple)" : ""}`,
        href: logoVariantSvgs[style][kind][tone],
        download: `opencode-${kind}-${style}-${tone}.svg`,
      })),
    ),
  )

  return (
    <Show when={shown()}>
      {(position) => {
        let root!: HTMLDivElement
        let closing: Animation[] = []
        // The rows that animate, and what the arrow keys visit.
        const rows = () => [...root.children] as HTMLElement[]
        const items = () => [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

        // Every item springs down from just above its place, sliding out from under the item above
        // it (earlier items sit on top), so none travels far or appears from behind.
        const open = () => {
          // Keep the fan inside the window; a list taller than the space scrolls.
          root.style.maxHeight = `${window.innerHeight - root.getBoundingClientRect().top - 8}px`
          root.toggleAttribute("data-scroll", root.scrollHeight > root.clientHeight)
          // Reopened while closing: spring back from wherever the items are.
          const rebound = closing.length > 0
          const previous = closing
          closing = []
          rows().forEach((item, index) => {
            const fade = [...(rebound ? [] : [{ opacity: 0 }]), { opacity: 1 }]
            if (still()) return item.animate(fade, { duration: 150, easing: "ease-out" })
            const timing = { delay: index * stagger, fill: "backwards" as const }
            item.animate([...(rebound ? [] : [{ transform: start(index) }]), { transform: rest }], {
              ...timing,
              duration: 450,
              easing: spring,
            })
            item.animate(fade, { ...timing, duration: 140, easing: "ease-out" })
            // A lifted shadow while the item drops, settling as it lands.
            item.toggleAttribute("data-lift", true)
            setTimeout(() => item.removeAttribute("data-lift"), timing.delay + 180)
          })
          previous.forEach((animation) => animation.cancel())
        }

        const close = () => {
          const list = rows()
          closing = list.flatMap((item, index) => {
            const delay = (list.length - 1 - index) * 14
            if (still()) return [item.animate([{ opacity: 0 }], { duration: 120, easing: "ease-in", fill: "forwards" })]
            // A small dip before the items lift and fold back up, bottom item first.
            item.toggleAttribute("data-lift", true)
            return [
              item.animate([{ transform: start(index) }], {
                delay,
                duration: 220,
                easing: "cubic-bezier(0.5, -0.5, 0.8, 0.3)",
                fill: "forwards",
              }),
              item.animate([{ opacity: 0 }], { delay: delay + 80, duration: 140, easing: "ease-in", fill: "forwards" }),
            ]
          })
          const animations = closing
          Promise.all(animations.map((animation) => animation.finished))
            .then(() => {
              if (closing === animations) setClosed(true)
            })
            // A reopen cancels the closing animations.
            .catch(() => undefined)
        }

        createEffect(
          on(
            () => !props.position,
            (leaving) => {
              root.toggleAttribute("data-closing", leaving)
              if (leaving) return close()
              open()
            },
          ),
        )

        // Arrows work as soon as the fan opens, even after a right-click left focus on the page.
        const keys = (event: KeyboardEvent) => {
          if (!props.position) return
          const list = items()
          const index = list.indexOf(document.activeElement as HTMLElement)
          const next = {
            ArrowDown: (index + 1) % list.length,
            ArrowUp: index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length,
            Home: 0,
            End: list.length - 1,
          }[event.key]
          if (next === undefined) return
          event.preventDefault()
          list[next]?.focus()
        }
        document.addEventListener("keydown", keys)
        onCleanup(() => document.removeEventListener("keydown", keys))

        // Earlier items sit on top, so each item slides out from under the one above.
        const stack = (index: number) => ({ "z-index": files.length + 3 - index })

        return (
          <div
            ref={root}
            data-component="logo-fan"
            data-item={siteSettings.logoMenuItem}
            role="menu"
            aria-label={i18n.t("nav.context.brandAssets")}
            style={{ left: `${position().x}px`, top: `${position().y}px` }}
            onClick={(event) => {
              if ((event.target as Element).closest('[role="menuitem"]')) props.onSelect()
            }}
          >
            <For each={files}>
              {(file, index) => (
                <a role="menuitem" href={file.href} download={file.download} style={stack(index())}>
                  <span data-slot="thumb" data-tone={file.tone} data-kind={file.kind} data-style={file.style}>
                    <img src={file.href} alt="" />
                  </span>
                  <span data-slot="label">
                    {file.name}
                    <span data-slot="meta"> · {file.tone === "light" ? "Light" : "Dark"} SVG</span>
                  </span>
                </a>
              )}
            </For>
            <A role="menuitem" href={language.route("/brand")} style={stack(files.length)}>
              <span data-slot="thumb" data-kind="guide" aria-hidden="true">
                {/* A ruler: the brand guidelines. */}
                <svg
                  data-slot="ruler"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.25"
                >
                  <rect x="1.625" y="5.625" width="12.75" height="4.75" />
                  <path d="M4.5 5.625V7.75M7 5.625V8.5M9.5 5.625V7.75M12 5.625V8.5" />
                </svg>
              </span>
              <span data-slot="label">
                Brand
                <span data-slot="meta"> · Page</span>
              </span>
            </A>
            <a role="menuitem" href={brandAssets} download="opencode-brand-assets.zip" style={stack(files.length + 1)}>
              <span data-slot="thumb" data-kind="zip" aria-hidden="true">
                {/* A zip file: a page with a zipper of alternating pixels and its pull. */}
                <svg
                  data-slot="zipfile"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.25"
                >
                  <path d="M3.625 1.625H12.375V14.375H3.625Z" />
                  <path
                    d="M7 2H8V3H7ZM8 3H9V4H8ZM7 4H8V5H7ZM8 5H9V6H8ZM7 6H8V7H7ZM8 7H9V8H8Z"
                    fill="currentColor"
                    stroke="none"
                  />
                  <path d="M6.625 8.625H9.375V11.375H6.625Z" />
                </svg>
              </span>
              <span data-slot="label">
                Brand assets
                <span data-slot="meta"> · ZIP</span>
              </span>
            </a>
            <A role="menuitem" href={language.route("/press")} style={stack(files.length + 2)}>
              <span data-slot="thumb" data-kind="press" aria-hidden="true">
                {/* Settings › Press icon picks the drawing (press-icons.ts). */}
                <svg
                  data-slot="paper"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.25"
                >
                  <For each={pressIcons[siteSettings.pressIcon].shapes}>
                    {(shape) => (
                      <path
                        d={shape.d}
                        fill={"fill" in shape && shape.fill ? "currentColor" : undefined}
                        stroke={"fill" in shape && shape.fill ? "none" : undefined}
                      />
                    )}
                  </For>
                </svg>
              </span>
              <span data-slot="label">
                Press
                <span data-slot="meta"> · Page</span>
              </span>
            </A>
          </div>
        )
      }}
    </Show>
  )
}

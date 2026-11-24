import "./logo-wall.css"
import { createEffect, createSignal, createUniqueId, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
import { balance, type Logo, logoCount, logoWall, logoWidth } from "./logo-wall-motion"
import { revealMotion } from "./reveal"
import type { logoAnimations, logoLayouts, SiteSettings } from "./settings"

// Where each layout puts the label: the first card, the first half card, nowhere, a line above,
// or the section title (outside the row).
const layouts = {
  "label + 6": "card",
  "label + 7": "half",
  "8 logos": "none",
  "label above + 8": "above",
  section: "section",
} as const

const [replays, setReplays] = createSignal(0)
export const replayLogos = () => setReplays((count) => count + 1)

/**
 * The logo row under the home hero, on the carousel's card grid. The row spans the whole cards that
 * fit (up to four); the label takes the first card or half card as the layout says, and the rest
 * holds two logos per card in fixed slots: the first logo's ink starts on the area's left edge, the
 * last one's ends on its right edge, and the slots between are spaced so the gaps are even for a
 * logo of average width. What it does once the page's code runs (measuring, the entrance and the
 * swaps) is logo-wall-motion.ts, here and on the static pages; this renders the row for four cards,
 * with its logos unseen until then (reveal.css, logo-wall.css).
 */
export function LogoWall(props: {
  kind: "companies" | "providers"
  layout: (typeof logoLayouts)[number]
  label: string
  /** A shorter label, shown instead when the label's column can't fit `label` on one line. */
  shortLabel?: string
  items: Logo[]
  animation: (typeof logoAnimations)[number]
  tuning: SiteSettings["logoTuning"]
  // Seconds between swaps.
  interval: number
  // Milliseconds between logos in the entrance wash.
  stagger: number
  opacity: number
}) {
  const label = () => layouts[props.layout]
  const count = () => logoCount(label(), 4)
  let section!: HTMLElement

  // Again whenever Settings changes the row (Design mode).
  onMount(() =>
    createEffect(() => {
      const wall = logoWall(section, {
        label: label(),
        items: props.items,
        interval: props.interval,
        stagger: props.stagger,
        duration: props.tuning[props.animation].duration,
      })
      onCleanup(wall.stop)
      // Settings › Replay swaps one logo now, so a change to the animation can be previewed.
      createEffect(on(replays, wall.swap, { defer: true }))
    }),
  )

  const fitID = createUniqueId()

  return (
    <section
      ref={section}
      data-component="logo-wall"
      data-section="logos"
      data-design="logoWall logoAnimation logoStagger logoLayout logoDividers logoLabel spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
      data-kind={props.kind}
      data-layout={label()}
      data-reveal
      data-entrance
      data-animation={props.animation}
      style={{
        "--logo-opacity": props.opacity / 100,
        "--fit": 4,
        "--count": count(),
        // The average logo width (in --logo-size units) over the whole list, which spaces the slots.
        "--average": (
          props.items.reduce((sum, item) => sum + logoWidth(item.metrics), 0) / Math.max(1, props.items.length)
        ).toFixed(3),
        ...revealMotion(props.animation, props.tuning),
      }}
      aria-label={`${props.label}: ${props.items.map((item) => item.name).join(", ")}`}
    >
      <Show when={label() === "above"}>
        <p
          data-slot="label"
          data-design-copy={props.kind === "companies" ? "home.logos.label" : undefined}
          aria-hidden="true"
        >
          {props.label}
        </p>
      </Show>
      <div data-slot="row">
        <span data-slot="probe" aria-hidden="true" />
        <Show when={label() === "card" || label() === "half"}>
          <p
            data-slot="label"
            data-size={label()}
            data-design-copy={props.kind === "companies" ? "home.logos.label" : undefined}
            data-fit={fitID}
            aria-hidden="true"
          >
            <Show
              when={props.shortLabel && props.shortLabel !== props.label}
              fallback={<LabelText text={props.label} />}
            >
              {/* Both forms are in the page from the server; a container query on this label's
                  column shows one (display: none takes the other out of the accessibility tree). */}
              <style innerHTML={fitRule(fitID, props.label)} />
              <span data-slot="long">
                <LabelText text={props.label} />
              </span>
              <span data-slot="short">
                <LabelText text={props.shortLabel!} />
              </span>
            </Show>
          </p>
        </Show>
        <div data-slot="logos" aria-hidden="true">
          {/* Rendered once: logo-wall-motion.ts takes them over. */}
          {untrack(() =>
            props.items.slice(0, count()).map((item, slot) => (
              <div data-slot="slot" style={{ "--index": slot }}>
                <LogoMark item={item} />
              </div>
            )),
          )}
        </div>
      </div>
    </section>
  )
}

// Only the artwork: the names are in the row's accessible label. logo-wall-motion.ts draws the same.
function LogoMark(props: { item: Logo }) {
  return (
    <span data-slot="brand">
      <span data-slot="mark" style={{ "--logo": `url(${props.item.logo})`, ...balance(props.item.metrics) }} />
    </span>
  )
}

/**
 * The container query that swaps the label for its short form: below the long label's width plus a
 * 24px gap to the logos. The label is set in OpenTUI Mono, so its width is 0.6em a character (twice
 * that for CJK and Hangul); scripts drawn in fallback fonts (Arabic, Thai, CJK) come out narrower,
 * so for them the estimate errs wide. `em` in a container query is the label's own font size.
 */
function fitRule(id: string, label: string) {
  const chars = [...label]
  const wide = chars.filter((char) =>
    /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/.test(char),
  ).length
  const width = ((chars.length + wide) * 0.6).toFixed(2)
  const at = `[data-site] [data-component="logo-wall"] [data-slot="label"][data-fit="${id}"]`
  return `@container (width < calc(${width}em + 24px)){${at}>[data-slot="long"]{display:none}${at}>[data-slot="short"]{display:inline}}`
}

/** The label's text with its number ("22M+", "22 Mio.+", "2,200万") kept on one line. */
function LabelText(props: { text: string }) {
  const parts = () => props.text.split(/(\d[\d,.]*(?:\s?(?:Mio\.|万|萬|만|ล้าน|M))?\+?)/)
  return <For each={parts()}>{(part, index) => (index() % 2 ? <span data-slot="number">{part}</span> : part)}</For>
}

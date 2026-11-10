import "./logo-wall.css"
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, onMount, Show } from "solid-js"
import { onEntrance, revealMotion } from "./reveal"
import type { logoAnimations, logoLayouts, SiteSettings } from "./settings"
import { useVisible } from "./visible"

type Logo = { name: string; logo: string; metrics: { aspect: number; density: number; centerY: number } }

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
 * logo of average width. Phones show six logos in two rows of three. Slots never move; a swap hands
 * over in place. Every few seconds one slot hands over to a logo that isn't on show. It pauses off
 * screen, in a background tab and with reduced motion.
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
  // Whole cards that fit the row, measured on mount and resize; four until then.
  const [fit, setFit] = createSignal(4)
  // Until then, CSS lays the row out for one card on phones, so the row doesn't jump on load.
  const [measured, setMeasured] = createSignal(false)
  // With one card (phones), a label in the row goes on its own line above two rows of three logos.
  const stacked = () => (label() === "card" || label() === "half") && fit() === 1
  // Tablets (641 to 1248px): CSS puts the label above the logos, so it takes no card of its own;
  // eight across in portrait (641 to 960px), six on wider tablets.
  const [tablet, setTablet] = createSignal(false)
  const [tabletCount, setTabletCount] = createSignal(6)
  const count = () => {
    if (fit() === 1) return 6
    if (tablet()) return tabletCount()
    if (label() === "card") return (fit() - 1) * 2
    if (label() === "half") return fit() * 2 - 1
    return fit() * 2
  }
  const slots = createMemo(() => Array.from({ length: count() }, (_, slot) => slot))
  // Slots hand over evens first, so neighbours never change one after another.
  const order = createMemo(() => [...slots().filter((slot) => slot % 2 === 0), ...slots().filter((slot) => slot % 2)])
  const [shown, setShown] = createSignal(slots())
  // The next logo to try, in list order.
  let next = slots().length
  let tick = 0
  // The entrance: the first time the row scrolls into view the logos arrive one at a time from the
  // left (top left first where they wrap), in the reveal style. Armed on the client only and never
  // with reduced motion; until the wash starts the logos are hidden, and no swap runs before it ends.
  const [armed, setArmed] = createSignal(false)
  const [start, setStart] = createSignal<number>()
  // Until the page's code runs, reveal.css keeps the logos unseen (data-entrance).
  const [mounted, setMounted] = createSignal(false)
  const entranceDone = () => {
    const at = start()
    if (at === undefined) return !armed()
    return performance.now() > at + count() * props.stagger + props.tuning[props.animation].duration + 300
  }
  let row: HTMLDivElement | undefined
  let probe: HTMLSpanElement | undefined

  createEffect(
    on(
      [() => props.items, slots],
      ([, slots]) => {
        setShown(slots)
        next = slots.length
        tick = 0
      },
      { defer: true },
    ),
  )

  const swap = () => {
    if (!row) return
    const live = order()
    const current = shown()
    const items = props.items.length
    const pick = Array.from({ length: items }, (_, step) => (next + step) % items).find(
      (index) => !current.includes(index),
    )
    if (pick === undefined || live.length === 0) return
    const slot = live[tick % live.length]
    tick++
    next = pick + 1
    setShown(current.map((index, i) => (i === slot ? pick : index)))
  }

  // The average logo width (in --logo-size units) over the whole list, which spaces the slots.
  const average = createMemo(
    () => props.items.reduce((sum, item) => sum + logoWidth(item.metrics), 0) / Math.max(1, props.items.length),
  )

  // Swaps run only while the row is on screen and the tab is showing.
  const visible = useVisible(() => row, "0px")

  onMount(() => {
    setMounted(true)
    const entrance =
      row && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? onEntrance(row, setStart) : undefined
    setArmed(!!entrance)
    // Whole cards across the row's container: the probe is one card wide, its margin one gutter.
    const measure = () => {
      if (!row?.parentElement || !probe) return
      const card = probe.getBoundingClientRect().width
      const gutter = parseFloat(getComputedStyle(probe).marginLeft)
      const width = row.parentElement.clientWidth
      setFit(Math.max(1, Math.min(4, Math.floor((width + gutter + 1) / (card + gutter)))))
      setTablet(window.matchMedia("(min-width: 40.0625rem) and (max-width: 78rem)").matches)
      setTabletCount(window.matchMedia("(max-width: 60rem)").matches ? 8 : 6)
      setMeasured(true)
    }
    const resize = new ResizeObserver(measure)
    if (row?.parentElement) resize.observe(row.parentElement)
    measure()
    onCleanup(() => {
      entrance?.()
      resize.disconnect()
    })
  })

  createEffect(() => {
    if (!visible() || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = setInterval(() => entranceDone() && swap(), props.interval * 1000)
    onCleanup(() => clearInterval(timer))
  })

  // Settings › Replay swaps one logo now, so a change to the animation can be previewed.
  createEffect(on(replays, swap, { defer: true }))

  const fitID = createUniqueId()

  return (
    <section
      data-component="logo-wall"
      data-section="logos"
      data-design="logoWall logoAnimation logoStagger logoLayout logoDividers logoLabel spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
      data-kind={props.kind}
      data-layout={label()}
      data-stacked={stacked() ? "" : undefined}
      data-measured={measured() ? "" : undefined}
      data-reveal
      data-entrance
      data-mounted={mounted() ? "" : undefined}
      data-armed={armed() ? "" : undefined}
      data-animation={props.animation}
      style={{
        "--logo-opacity": props.opacity / 100,
        "--fit": fit(),
        "--count": count(),
        "--average": average().toFixed(3),
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
      <div data-slot="row" ref={row}>
        <span data-slot="probe" ref={probe} aria-hidden="true" />
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
          <For each={slots()}>
            {(slot) => (
              <Slot
                index={slot}
                item={props.items[shown()[slot]]}
                entrance={start() === undefined ? undefined : start()! + slot * props.stagger}
              />
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

// `entrance` is when the slot's first logo arrives (a performance.now() time), once the wash starts.
function Slot(props: { index: number; item: Logo | undefined; entrance?: number }) {
  const [previous, setPrevious] = createSignal<Logo>()
  const [moved, setMoved] = createSignal(false)
  // A memo, so the slot reacts only when its own logo changes, not when a neighbour's does.
  const item = createMemo(() => props.item)
  // `on` with defer passes no previous value on the first change, so the slot keeps its own.
  let last = item()
  createEffect(
    on(
      item,
      (current) => {
        setPrevious(last)
        last = current
        setMoved(true)
      },
      { defer: true },
    ),
  )

  return (
    <div data-slot="slot" style={{ "--index": props.index }}>
      <Show when={item()} keyed>
        {(item) => (
          <LogoMark
            item={item}
            state={moved() || props.entrance !== undefined ? "in" : undefined}
            delay={moved() || props.entrance === undefined ? undefined : props.entrance - performance.now()}
          />
        )}
      </Show>
      <Show when={previous()} keyed>
        {(item) => <LogoMark item={item} state="out" onDone={() => setPrevious(undefined)} />}
      </Show>
    </div>
  )
}

// Only the artwork: the names are in the row's accessible label.
// `delay` (ms) replaces the row's arrival delay, for the entrance wash.
function LogoMark(props: { item: Logo; state?: "in" | "out"; delay?: number; onDone?: () => void }) {
  return (
    <span
      data-slot="brand"
      data-state={props.state}
      style={
        props.delay === undefined
          ? undefined
          : {
              "--logo-delay": `${Math.max(0, Math.round(props.delay))}ms`,
              "--wipe-delay": `${Math.max(0, Math.round(props.delay))}ms`,
            }
      }
      onAnimationEnd={() => props.onDone?.()}
    >
      <span
        data-slot="mark"
        style={{
          "--logo": `url(${props.item.logo})`,
          ...balance(props.item.metrics),
        }}
      />
    </span>
  )
}

function logoWidth(metrics: { aspect: number; density: number }) {
  const scale = Math.min(2, Math.max(0.5, (0.35 / metrics.density) ** 0.25))
  return metrics.aspect ** 0.5 * scale
}

// logo-soup's normalisation (https://github.com/johannschopplich/logo-soup): wide logos grow less
// than their aspect ratio, and light logos grow while heavy ones shrink, so they all read at about
// the same weight. Sizes are in multiples of --logo-size, which is the side of a square logo.
function balance(metrics: { aspect: number; density: number; centerY: number }) {
  const width = logoWidth(metrics)
  const height = width / metrics.aspect
  return {
    "--width": width.toFixed(3),
    "--aspect": metrics.aspect,
    "--shift": (-metrics.centerY * height).toFixed(3),
  }
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

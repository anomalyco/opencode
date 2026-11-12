import { onEntrance } from "./reveal"

export type Logo = { name: string; logo: string; metrics: { aspect: number; density: number; centerY: number } }

/**
 * What the logo row does (LogoWall in logo-wall.tsx renders it, in the app and on the static pages):
 * it measures the whole cards that fit its row (up to four) and fills the row's slots for them, two
 * logos per card, six in two rows of three on phones; the server assumes four. The first time the
 * row scrolls into view the logos arrive one at a time from the left, `stagger` ms apart, in the
 * reveal style; then every `interval` seconds one slot hands over to a logo that isn't on show, evens
 * first, so neighbours never change one after another. Slots never move; a swap hands over in place.
 * It pauses off screen, in a background tab and with reduced motion.
 *
 * No framework code: it owns the row's logos and its measured state. `section` is LogoWall's
 * element, `label` where its layout puts the label (logo-wall.tsx), `duration` the entrance
 * animation's length in ms. Returns `swap` (one swap now, for
 * Settings › Replay) and its stop.
 */
export function logoWall(
  section: HTMLElement,
  options: { label: string; items: Logo[]; interval: number; stagger: number; duration: number },
) {
  const row = section.querySelector<HTMLElement>('[data-slot="row"]')!
  const probe = row.querySelector<HTMLElement>('[data-slot="probe"]')!
  const logos = row.querySelector<HTMLElement>('[data-slot="logos"]')!
  const items = options.items
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  let slots: HTMLElement[] = []
  // The logo in each slot, by its index in `items`, and the slots whose logo has changed since they
  // came in (they hand over without the entrance's delay).
  let shown: number[] = []
  const moved = new WeakSet<HTMLElement>()
  // Slots hand over evens first.
  let order: number[] = []
  // The next logo to try, in list order.
  let next = 0
  let tick = 0
  // When the entrance wash starts (a performance.now() time).
  let start: number | undefined

  const fill = (count: number) => {
    if (count === slots.length) return
    slots.slice(count).forEach((slot) => slot.remove())
    slots = slots.slice(0, count)
    slots.forEach((slot, index) => shown[index] !== index && hand(slot, index))
    while (slots.length < count) {
      const slot = document.createElement("div")
      slot.dataset.slot = "slot"
      slot.style.setProperty("--index", String(slots.length))
      slot.append(logoMark(items[slots.length]))
      if (start !== undefined) arrive(slot, slots.length)
      logos.append(slot)
      slots.push(slot)
    }
    shown = slots.map((_, index) => index)
    order = [...shown.filter((slot) => slot % 2 === 0), ...shown.filter((slot) => slot % 2)]
    next = count
    tick = 0
    section.style.setProperty("--count", String(count))
  }
  // A slot's logo hands over to `item`, which comes in as the old one goes out.
  const hand = (slot: HTMLElement, item: number) => {
    const current = slot.firstElementChild
    slot.querySelector('[data-state="out"]')?.remove()
    const incoming = logoMark(items[item])
    incoming.dataset.state = "in"
    current?.replaceWith(incoming)
    const outgoing = logoMark(items[shown[slots.indexOf(slot)]])
    outgoing.dataset.state = "out"
    outgoing.addEventListener("animationend", () => outgoing.remove())
    slot.append(outgoing)
    moved.add(slot)
  }
  // A slot's first logo arrives in the wash, `stagger` ms after the slot before it.
  const arrive = (slot: HTMLElement, index: number) => {
    const mark = slot.firstElementChild as HTMLElement | null
    if (!mark || moved.has(slot)) return
    const delay = `${Math.max(0, Math.round(start! + index * options.stagger - performance.now()))}ms`
    mark.dataset.state = "in"
    mark.style.setProperty("--logo-delay", delay)
    mark.style.setProperty("--wipe-delay", delay)
  }
  const swap = () => {
    const pick = Array.from({ length: items.length }, (_, step) => (next + step) % items.length).find(
      (index) => !shown.includes(index),
    )
    if (pick === undefined || order.length === 0) return
    const slot = order[tick % order.length]
    tick++
    next = pick + 1
    hand(slots[slot], pick)
    shown[slot] = pick
  }
  const done = () =>
    start === undefined ? !armed : performance.now() > start + slots.length * options.stagger + options.duration + 300

  // The server's copy holds four cards' worth; this one starts empty.
  logos.replaceChildren()
  section.toggleAttribute("data-mounted", true)
  const entrance = reduced
    ? undefined
    : onEntrance(row, (at) => {
        start = at
        slots.forEach(arrive)
      })
  const armed = !!entrance
  section.toggleAttribute("data-armed", armed)

  // Whole cards across the row's container: the probe is one card wide, its margin one gutter. With
  // one card (phones), a label in the row goes on its own line above two rows of three logos.
  const measure = () => {
    const card = probe.getBoundingClientRect().width
    const gutter = parseFloat(getComputedStyle(probe).marginLeft)
    const fit = Math.max(1, Math.min(4, Math.floor((row.parentElement!.clientWidth + gutter + 1) / (card + gutter))))
    section.style.setProperty("--fit", String(fit))
    section.toggleAttribute("data-stacked", (options.label === "card" || options.label === "half") && fit === 1)
    section.toggleAttribute("data-measured", true)
    fill(
      logoCount(
        options.label,
        fit,
        matchMedia("(min-width: 40.0625rem) and (max-width: 78rem)").matches,
        matchMedia("(max-width: 60rem)").matches,
      ),
    )
  }
  const resize = new ResizeObserver(measure)
  resize.observe(row.parentElement!)
  measure()

  // Swaps run only while the row is on screen and the tab is showing.
  let near = false
  let timer = 0
  const run = () => {
    clearInterval(timer)
    if (!near || document.hidden || reduced) return
    timer = window.setInterval(() => done() && swap(), options.interval * 1000)
  }
  const visible = new IntersectionObserver(([entry]) => {
    near = entry.isIntersecting
    run()
  })
  visible.observe(row)
  document.addEventListener("visibilitychange", run)

  return {
    swap,
    stop: () => {
      entrance?.()
      resize.disconnect()
      visible.disconnect()
      document.removeEventListener("visibilitychange", run)
      clearInterval(timer)
    },
  }
}

/**
 * How many logos the row holds for `fit` whole cards, by where the label goes (logo-wall.tsx's
 * layouts). Phones show six; tablets (641 to 1248px) put the label above the logos, eight across in
 * portrait (641 to 960px) and six on wider ones.
 */
export function logoCount(label: string, fit: number, tablet = false, portrait = false) {
  if (fit === 1) return 6
  if (tablet) return portrait ? 8 : 6
  if (label === "card") return (fit - 1) * 2
  if (label === "half") return fit * 2 - 1
  return fit * 2
}

/** A logo's artwork in its slot, as LogoMark (logo-wall.tsx) draws the server's. */
function logoMark(item: Logo) {
  const brand = document.createElement("span")
  brand.dataset.slot = "brand"
  const mark = document.createElement("span")
  mark.dataset.slot = "mark"
  mark.style.setProperty("--logo", `url(${item.logo})`)
  Object.entries(balance(item.metrics)).forEach(([name, value]) => mark.style.setProperty(name, String(value)))
  brand.append(mark)
  return brand
}

export function logoWidth(metrics: { aspect: number; density: number }) {
  const scale = Math.min(2, Math.max(0.5, (0.35 / metrics.density) ** 0.25))
  return metrics.aspect ** 0.5 * scale
}

// logo-soup's normalisation (https://github.com/johannschopplich/logo-soup): wide logos grow less
// than their aspect ratio, and light logos grow while heavy ones shrink, so they all read at about
// the same weight. Sizes are in multiples of --logo-size, which is the side of a square logo.
export function balance(metrics: { aspect: number; density: number; centerY: number }) {
  const width = logoWidth(metrics)
  const height = width / metrics.aspect
  return {
    "--width": width.toFixed(3),
    "--aspect": metrics.aspect,
    "--shift": (-metrics.centerY * height).toFixed(3),
  }
}

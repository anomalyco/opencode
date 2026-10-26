import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import {
  frameLoop,
  observeReducedMotion,
  prefersReducedMotion,
  Spring,
  type DurationOptions,
} from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"

const group = "Composer"

const subsection = "Docks"

const presets = {
  snappy: { duration: 0.3, bounce: 0 },
  smooth: { duration: 0.4, bounce: 0 },
  calm: { duration: 0.55, bounce: 0 },
}

// Opening and closing share one height spring, so a dock leaves the way it came.
const morph = motionTuning.spring("docks.morph", {
  label: "Height",
  group,
  subsection,
  description: "Todo, queue and question docks",
  target: '[data-component="session-composer-dock"]',
  shipped: "smooth",
  presets,
})

const fadeIn = motionTuning.spring("docks.fade-in", { label: "Fade in", group, subsection, shipped: "smooth", presets })

// A closing face stays opaque until this much of its box is left, then fades out before the box closes.
const fadeTail = motionTuning.number("docks.fade-tail", {
  label: "Fade-out tail",
  group,
  subsection,
  value: 0.4,
  min: 0.05,
  max: 1,
  step: 0.05,
})

const blur = motionTuning.number("docks.blur", {
  label: "Blur",
  group,
  subsection,
  value: 0,
  min: 0,
  max: 6,
  step: 0.5,
  unit: "px",
})

export const queueStagger = motionTuning.number("docks.stagger", {
  label: "Queue row stagger",
  group,
  subsection,
  value: 0,
  min: 0,
  max: 0.12,
  step: 0.005,
  unit: "s",
  time: "duration",
})

const fade: DurationOptions = { duration: 0.15, bounce: 0 }

const snap = (px: number, dpr = window.devicePixelRatio || 1) => Math.round(px * dpr) / dpr

const surface =
  "data-[moving]:overflow-clip data-[dock-border-underlay]:rounded-xl data-[dock-border-underlay]:bg-v2-background-bg-base [[data-color-scheme=dark]_&[data-dock-border-underlay]]:bg-v2-background-bg-layer-01"

type Face<T> = {
  key: string
  value: Accessor<T>
  set: (value: T) => void
  leaving: Accessor<boolean>
  leave: (leaving: boolean) => void
  presence: Spring
  el?: HTMLDivElement
  height: number
}

// The composer and the docks that stand in for it as one surface: a new face grows the region to its height on one
// spring while the old face closes in its own box above or below it, so the two never draw over each other. Faces
// present on mount rest immediately.
export function ComposerMorph<T extends { key: string }>(props: {
  face: T
  children: (face: Accessor<T>) => JSX.Element
}) {
  const born = performance.now()
  const [faces, setFaces] = createSignal([face(props.face, 1)])
  let root: HTMLDivElement | undefined
  let height: Spring | undefined
  let stop: (() => void) | undefined

  const settle = (list: Face<T>[]) => {
    stop?.()
    stop = undefined
    height = undefined
    root?.removeAttribute("data-moving")
    root?.removeAttribute("data-dock-border-underlay")
    root?.style.removeProperty("height")
    list.forEach((item) => {
      const content = item.el?.firstElementChild instanceof HTMLElement ? item.el.firstElementChild : undefined

      ;["position", "inset-inline", "top", "transform", "clip-path", "opacity"].forEach((prop) =>
        item.el?.style.removeProperty(prop),
      )
      ;["transform", "filter", "mask-image"].forEach((prop) => content?.style.removeProperty(prop))
    })
    setFaces(list.filter((item) => !item.leaving()))

    return false
  }

  // Face heights come from a ResizeObserver; this one read happens only when a flight starts.
  const measure = () => {
    for (const item of untrack(faces)) if (item.el) item.height = item.el.getBoundingClientRect().height
  }

  // Each face gets a box: a closing face keeps its presence's share of its height, and the face coming in takes what is
  // left of the region. During a flight the faces are stacked with transforms and cut to their boxes with clip-path, so
  // only the region's own height changes layout. Under reduced motion the closing faces fade out in full first, then
  // the new face fades in.
  const paintFaces = (list: Face<T>[], shown: number) => {
    const reduced = prefersReducedMotion()
    const leaving = list.filter((item) => item.leaving())
    const waiting = reduced && leaving.some((item) => item.presence.value > 0.01)

    const boxes = new Map(
      leaving.map((item) => [
        item,
        reduced ? (waiting ? item.height : 0) : snap(item.height * Math.max(0, Math.min(1, item.presence.value))),
      ]),
    )

    const used = [...boxes.values()].reduce((sum, box) => sum + box, 0)
    let offset = 0
    list.forEach((item) => {
      if (!item.el) return
      const box = boxes.get(item) ?? (waiting ? 0 : Math.max(0, Math.min(item.height, shown - used)))
      const content = item.el.firstElementChild instanceof HTMLElement ? item.el.firstElementChild : item.el
      item.el.style.position = "absolute"
      item.el.style.insetInline = "0"
      item.el.style.top = "0"
      item.el.style.transform = `translateY(${offset}px)`
      item.el.style.clipPath = `inset(0 0 calc(100% - ${box.toFixed(2)}px) 0)`
      offset += box
      const p = item.leaving() ? (reduced ? item.presence.value : box / Math.max(1, item.height)) : item.presence.value
      styleFace(item.el, Math.max(0, Math.min(1, p)), {
        dy: item.leaving() ? 0 : 6,
        out: item.leaving(),
        hidden: item.height - box,
        content,
      })
    })
  }

  const regionHeight = (list: Face<T>[], spring: Spring) => {
    if (!prefersReducedMotion()) return snap(spring.value)
    const leaving = list.filter((item) => item.leaving() && item.presence.value > 0.01)

    return leaving.length ? leaving.reduce((sum, item) => sum + item.height, 0) : spring.target
  }

  const paint = (dt: number) => {
    const list = untrack(faces)
    const entering = list.find((item) => !item.leaving())

    if (!root || !height || !entering) return false

    // A face that just mounted has no height until its ResizeObserver reports one.
    if (entering.height > 0 && height.target !== entering.height) height.set(entering.height)
    const reduced = prefersReducedMotion()

    if (reduced) height.snap(entering.height)
    height.step(dt)

    if (Math.abs(height.value - height.target) < 0.5 && Math.abs(height.velocity) < 5) height.snap(height.target)
    const waiting = reduced && list.some((item) => item.leaving() && item.presence.value > 0.01)
    list.forEach((item) => {
      if (waiting && !item.leaving()) return
      item.presence.step(dt)

      if (Math.abs(item.presence.value - item.presence.target) < 0.01 && Math.abs(item.presence.velocity) < 0.05)
        item.presence.snap(item.presence.target)
    })

    if (height.resting && list.every((item) => item.presence.resting)) return settle(list)
    const shown = regionHeight(list, height)
    // Written every frame, never read back: the timeline inset follows the region's real height (as in #57559).
    root.style.height = `${shown}px`
    paintFaces(list, shown)

    return true
  }

  createEffect(
    on(
      () => props.face,
      (next) => {
        const list = untrack(faces)
        const current = list.find((item) => !item.leaving())

        if (current?.key === next.key) return current.set(next)

        if (!root || performance.now() - born < 250) return setFaces([face(next, 1)])

        const from = height ? height.value : root.getBoundingClientRect().height
        const reduced = prefersReducedMotion()
        const back = next.key === "composer" ? list.find((item) => item.key === next.key) : undefined
        const entering = back ?? face(next, 0)
        const active = list.filter((item) => item === entering || item.presence.value >= 0.01)
        // The closing box must start at the face's full height, which only a fresh measure knows.
        measure()

        active.forEach((item) => {
          if (item === entering) return
          item.leave(true)

          if (item.el?.contains(document.activeElement) && document.activeElement instanceof HTMLElement)
            document.activeElement.blur()
          // A closing face's box closes on the region's spring, so the boxes always add up to the region.
          tune(item.presence, reduced ? fade : morph()).set(0)
        })
        entering.set(next)
        entering.leave(false)
        tune(entering.presence, reduced ? fade : fadeIn()).set(1)
        height ??= Spring.fromDuration(from, morph())
        tune(height, morph())

        // Docks always stack above the composer, whichever is coming or going.
        const nextFaces = (back ? active : [...active, entering]).toSorted(
          (a, b) => Number(a.key === "composer") - Number(b.key === "composer"),
        )

        const shown = regionHeight(nextFaces, height)
        root.toggleAttribute("data-moving", true)
        root.toggleAttribute("data-dock-border-underlay", true)
        root.style.height = `${shown}px`
        paintFaces(nextFaces, shown)
        setFaces(nextFaces)
        stop ??= frameLoop.add(paint)
      },
      { defer: true },
    ),
  )

  onCleanup(observeReducedMotion(() => prefersReducedMotion() && stop && settle(untrack(faces))))
  onCleanup(() => stop?.())

  return (
    <div ref={root} data-slot="composer-morph" class={`relative z-10 flex flex-col ${surface}`}>
      <For each={faces()}>
        {(item) => (
          <div
            ref={(el) => {
              item.el = el

              const observer = new ResizeObserver((entries) => {
                const size = entries[0]?.borderBoxSize[0]?.blockSize

                if (size !== undefined) item.height = size
              })

              observer.observe(el)
              onCleanup(() => observer.disconnect())

              if (height) paintFaces(untrack(faces), snap(height.value))
            }}
            data-slot="composer-face"
            inert={item.leaving()}
            aria-hidden={item.leaving() || undefined}
            class="shrink-0"
            classList={{ "pointer-events-none": item.leaving() }}
          >
            {props.children(item.value)}
          </div>
        )}
      </For>
    </div>
  )
}

function face<T extends { key: string }>(value: T, presence: number): Face<T> {
  const [current, set] = createSignal(value)
  const [leaving, leave] = createSignal(false)

  return { key: value.key, value: current, set, leaving, leave, presence: new Spring(presence), height: 0 }
}

function tune(spring: Spring, options: DurationOptions) {
  spring.omega = (2 * Math.PI) / options.duration
  spring.zeta = 1 - options.bounce

  return spring
}

// A face coming in eases its opacity in late. A face going out stays opaque until only the fade-out tail of its box is
// left, then fades, so it is gone just as its box closes.
function styleFace(
  el: HTMLElement,
  p: number,
  input: { dy: number; out: boolean; hidden?: number; content?: HTMLElement },
) {
  const content = input.content ?? el
  const hidden = input.hidden ?? 0
  el.style.opacity = `${(input.out ? Math.min(1, p / fadeTail()) : p * p).toFixed(4)}`

  // Movement, blur and the soft edge go on the content inside the clipping box, never on the box itself, so a blur
  // can't bleed past it. Before the content mounts there is nothing to move.
  if (prefersReducedMotion() || content === el) return
  content.style.transform = `translateY(${((1 - p) * input.dy).toFixed(2)}px)`
  content.style.filter = p < 0.999 && blur() > 0 ? `blur(${((1 - p) * blur()).toFixed(2)}px)` : ""
  content.style.maskImage =
    hidden > 0 ? `linear-gradient(to top, transparent ${hidden}px, #000 ${hidden + Math.min(24, hidden)}px)` : ""
}

// Mounts its children when `when` turns truthy and grows them in; when it turns falsy they close and unmount.
export function Grow<T>(props: {
  when: T | undefined | null | false
  appear?: boolean
  fade?: boolean
  card?: boolean
  class?: string
  /** The spring it closes on, when it closes alongside other motion that should share it. */
  close?: () => DurationOptions
  onClosed?: () => void
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element)
}) {
  const [present, setPresent] = createSignal(!!props.when)
  // SAFETY: a truthy `when` is neither null nor undefined.
  const item = createMemo((prev?: NonNullable<T>) => (props.when ? (props.when as NonNullable<T>) : prev))
  let el: HTMLDivElement | undefined
  let entering = !!props.when && !!props.appear

  createEffect(
    on(
      () => [!!props.when, present()] as const,
      ([when, shown], prev) => {
        if (when && !shown) {
          entering = true

          return setPresent(true)
        }

        if (!el || (!entering && (!prev || prev[0] === when))) return
        entering = false
        grow(el, when, props.fade, props.card, props.close?.(), () => {
          setPresent(false)
          props.onClosed?.()
        })
      },
    ),
  )

  return (
    <Show when={present()}>
      <div
        ref={el}
        inert={!props.when}
        class={[props.class, props.card && "[&:not(:last-child)]:mb-2", surface].filter(Boolean).join(" ")}
      >
        {(() => {
          const child = props.children

          return child instanceof Function ? (
            <Show when={item()} keyed>
              {child}
            </Show>
          ) : (
            child
          )
        })()}
      </div>
    </Show>
  )
}

const growing = new WeakMap<HTMLElement, { spring: Spring; presence: Spring; open: boolean; done?: () => void }>()

function grow(
  el: HTMLElement,
  open: boolean,
  withFade?: boolean,
  card?: boolean,
  close?: DurationOptions,
  done?: () => void,
) {
  const reduced = prefersReducedMotion()
  const current = growing.get(el)

  if (current) {
    current.open = open
    current.done = done
    tune(current.spring, reduced ? fade : open ? morph() : (close ?? morph()))
    tune(current.presence, reduced ? fade : fadeIn())

    return
  }

  const mb = parseFloat(getComputedStyle(el).marginBottom) || 0

  const prevMb =
    (!mb && el.previousElementSibling ? parseFloat(getComputedStyle(el.previousElementSibling).marginBottom) : 0) || 0

  const state = {
    spring: Spring.fromDuration(
      open ? 0 : el.getBoundingClientRect().height,
      reduced ? fade : open ? morph() : (close ?? morph()),
    ),
    // Opening fades in on its own spring; closing fades with the height, inside the closing box.
    presence: Spring.fromDuration(open ? 0 : 1, reduced ? fade : fadeIn()),
    open,
    done,
  }

  growing.set(el, state)
  el.toggleAttribute("data-moving", true)
  el.toggleAttribute("data-dock-border-underlay", !!card)

  if (!reduced) {
    el.style.height = `${snap(state.spring.value)}px`

    if (open && mb > 0) el.style.marginBottom = "0px"

    if (open && prevMb > 0) el.style.marginTop = `${-prevMb}px`
  }

  if ((withFade || reduced) && open) el.style.opacity = "0"

  // The content's height is read once here, then kept current by a ResizeObserver rather than read every frame.
  const child = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : undefined
  const margin = child ? parseFloat(getComputedStyle(child).marginBottom) || 0 : 0

  if (margin < 0) el.style.overflowClipMargin = `${-margin}px`
  let full = child ? child.getBoundingClientRect().height + margin : 0

  const observer = new ResizeObserver((entries) => {
    const size = entries[0]?.borderBoxSize[0]?.blockSize

    if (size !== undefined) full = size + margin
  })

  if (child) observer.observe(child)
  frameLoop.add((dt) => {
    if (!el.isConnected) {
      observer.disconnect()
      growing.delete(el)

      return false
    }

    const noMotion = prefersReducedMotion()
    const size = state.open ? full : 0
    state.spring.set(size).step(dt)

    if (Math.abs(state.spring.value - size) < 0.5 && Math.abs(state.spring.velocity) < 5) state.spring.snap(size)
    const shown = state.open ? 1 : 0
    state.presence.set(shown).step(dt)

    if (Math.abs(state.presence.value - shown) < 0.01 && Math.abs(state.presence.velocity) < 0.05)
      state.presence.snap(shown)

    if (state.spring.resting && (!withFade || !state.open || state.presence.resting)) {
      observer.disconnect()
      growing.delete(el)
      finish(el, state.open, state.done)

      return false
    }

    const value = snap(Math.max(0, state.spring.value))
    const p = Math.max(0, Math.min(1, state.spring.value / Math.max(1, full)))
    const presence = Math.max(0, Math.min(1, state.presence.value))

    if (!noMotion) {
      // Written every frame, never read back: neighbours and the timeline inset follow the real height (as in #57559).
      el.style.height = `${value}px`

      if (mb > 0) el.style.marginBottom = `${snap(mb * p)}px`

      if (prevMb > 0) el.style.marginTop = `${snap(-prevMb * (1 - p))}px`
    }

    if (withFade || noMotion) {
      const child = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el
      styleFace(el, state.open ? presence : p, {
        dy: state.open ? 4 : 0,
        out: !state.open,
        hidden: card ? full - value : 0,
        content: child,
      })
    }

    return true
  })
}

function finish(el: HTMLElement, open: boolean, done?: () => void) {
  const child = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : undefined
  el.removeAttribute("data-moving")
  el.removeAttribute("data-dock-border-underlay")
  ;[
    "height",
    "margin-top",
    "margin-bottom",
    "overflow-clip-margin",
    "opacity",
    "filter",
    "transform",
    "mask-image",
  ].forEach((prop) => {
    el.style.removeProperty(prop)
    child?.style.removeProperty(prop)
  })

  if (!open) done?.()
}

// Fades `rows` in one after another on the fade-in spring, `step` seconds apart, on the shared frame loop. Returns its
// cancellation, which clears what it painted.
export function cascade(rows: HTMLElement[], step: number) {
  const springs = rows.map(() => Spring.fromDuration(0, fadeIn()))

  const clear = () =>
    rows.forEach((el) => ["opacity", "filter", "transform"].forEach((prop) => el.style.removeProperty(prop)))

  let elapsed = 0

  const paintRow = (el: HTMLElement, p: number) => {
    el.style.opacity = `${(p * p).toFixed(4)}`
    el.style.transform = `translateY(${((1 - p) * 4).toFixed(2)}px)`
  }

  rows.forEach((el) => paintRow(el, 0))

  const stop = frameLoop.add((dt) => {
    elapsed += dt
    springs.forEach((spring, index) => {
      if (elapsed < index * step) return
      spring.set(1).step(dt)

      if (Math.abs(spring.value - 1) < 0.01 && Math.abs(spring.velocity) < 0.05) spring.snap(1)
    })

    if (springs.every((spring) => spring.value === 1)) {
      clear()

      return false
    }

    rows.forEach((el, index) => paintRow(el, Math.max(0, Math.min(1, springs[index]!.value))))

    return true
  })

  return () => {
    stop()
    clear()
  }
}

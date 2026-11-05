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
import {
  createGrowState,
  createMorphState,
  didGrowClose,
  DISPOSED_GROW_EVENT,
  DISPOSED_MORPH_EVENT,
  hasInstantMorphFace,
  isGrowInteractive,
  isGrowMounted,
  isGrowMoving,
  isMorphFaceLeaving,
  MORPH_MOUNT_GRACE_MS,
  morphActive,
  morphFace,
  morphFaces,
  REDUCED_GROW_EVENT,
  SETTLE_MORPH_EVENT,
  transitionGrow,
  transitionMorph,
  type GrowEvent,
  type GrowState,
  type MorphEvent,
  type MorphFace,
  type MorphState,
} from "./spring-height-machine"

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

const surface =
  "data-[moving]:overflow-clip data-[dock-border-underlay]:rounded-xl data-[dock-border-underlay]:bg-v2-background-bg-base [[data-color-scheme=dark]_&[data-dock-border-underlay]]:bg-v2-background-bg-layer-01"

// The composer and the docks that stand in for it as one surface: a new face grows the region to its height on one
// spring while the old face closes in its own box above or below it, so the two never draw over each other. Faces
// present on mount rest immediately, as does a change to or from a face `instant` picks.
export function ComposerMorph<T extends { key: string }>(props: {
  face: T
  instant?: (face: T) => boolean
  children: (face: Accessor<T>) => JSX.Element
}) {
  const born = performance.now()
  let current = createMorphState(props.face)
  const [state, setState] = createSignal(current)
  const faceElements = new Map<number, HTMLDivElement>()
  const frame = { type: "frame" as const, attempt: 0, dt: 0, reduced: false, dpr: 1 }
  let root: HTMLDivElement | undefined
  let stopFrame: (() => void) | undefined

  const dispatch = (event: MorphEvent<T>) => {
    const previous = current
    const next = transitionMorph(previous, event)

    if (next === previous) return
    current = next

    if (previous.status === "flying" && next.status !== "flying") {
      stopFrame?.()
      stopFrame = undefined
      settle(previous.faces)
    }

    if (next.status === "disposed") return

    if (next.status === "flying") {
      const focused = document.activeElement

      if (
        focused instanceof HTMLElement &&
        next.faces.some((face) => face !== next.entering && faceElements.get(face.id)?.contains(focused))
      )
        focused.blur()
    }

    setState(next)

    if (next.status !== "flying" || !root) return
    root.toggleAttribute("data-moving", true)
    root.toggleAttribute("data-dock-border-underlay", true)
    // A face that mounts with this state paints itself from its ref.
    paint(next, prefersReducedMotion())
    stopFrame ??= frameLoop.add(tick)
  }

  const tick = (dt: number) => {
    if (current.status !== "flying") return false

    if (!root?.isConnected) {
      dispatch(SETTLE_MORPH_EVENT)

      return false
    }

    frame.attempt = current.attempt
    frame.dt = dt
    frame.reduced = prefersReducedMotion()
    frame.dpr = window.devicePixelRatio || 1
    dispatch(frame)

    if (current.status !== "flying") return false
    // Written every frame, never read back: the timeline inset follows the region's real height (as in #57559).
    paint(current, frame.reduced)

    return true
  }

  // During a flight the faces are stacked with transforms and cut to their boxes with clip-path, so only the region's
  // own height changes layout.
  const paint = (flight: Extract<MorphState<T>, { status: "flying" }>, reduced: boolean) => {
    if (!root) return
    root.style.height = `${flight.shown}px`

    for (const face of flight.faces) {
      const el = faceElements.get(face.id)

      if (!el) continue
      const leaving = face !== flight.entering
      el.style.position = "absolute"
      el.style.insetInline = "0"
      el.style.top = "0"
      el.style.transform = `translateY(${face.offset}px)`
      el.style.clipPath = `inset(0 0 calc(100% - ${face.box.toFixed(2)}px) 0)`
      styleFace(
        el,
        el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el,
        face.progress,
        leaving ? 0 : 6,
        leaving,
        (face.height ?? 0) - face.box,
        reduced,
      )
    }
  }

  const settle = (faces: readonly MorphFace<T>[]) => {
    root?.removeAttribute("data-moving")
    root?.removeAttribute("data-dock-border-underlay")
    root?.style.removeProperty("height")
    faces.forEach((face) => {
      const el = faceElements.get(face.id)

      if (!el) return

      const content = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : undefined

      ;["position", "inset-inline", "top", "transform", "clip-path", "opacity"].forEach((prop) =>
        el.style.removeProperty(prop),
      )
      ;["transform", "filter", "mask-image"].forEach((prop) => content?.style.removeProperty(prop))
    })
  }

  createEffect(
    on(
      () => props.face,
      (face) => {
        const active = morphActive(current)

        const instant =
          !root?.isConnected ||
          performance.now() - born < MORPH_MOUNT_GRACE_MS ||
          !!props.instant?.(face) ||
          hasInstantMorphFace(current, props.instant)

        const flies = !instant && !!active && active.value.key !== face.key

        // The closing box must start at the face's full height, which only a fresh measure knows. Face heights come
        // from a ResizeObserver otherwise; these reads happen only when a flight starts.
        if (flies)
          faceElements.forEach((el, id) =>
            dispatch({ type: "face.measured", id, height: el.getBoundingClientRect().height }),
          )

        dispatch({
          type: "face.changed",
          face,
          instant,
          reduced: prefersReducedMotion(),
          dpr: window.devicePixelRatio || 1,
          from: flies && current.status === "resting" && root ? root.getBoundingClientRect().height : 0,
          curves: { morph: morph(), fadeIn: fadeIn() },
        })
      },
      { defer: true },
    ),
  )

  // A face that turns instant mid-flight lands at once.
  createEffect(() => {
    const flight = state()

    if (flight.status === "flying" && hasInstantMorphFace(flight, props.instant)) dispatch(SETTLE_MORPH_EVENT)
  })

  onCleanup(observeReducedMotion(() => prefersReducedMotion() && dispatch(SETTLE_MORPH_EVENT)))
  onCleanup(() => dispatch(DISPOSED_MORPH_EVENT))

  const ids = createMemo(() => morphFaces(state()).map((face) => face.id), [], {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  })

  return (
    <div ref={root} data-slot="composer-morph" class={`relative z-10 flex flex-col ${surface}`}>
      <For each={ids()}>
        {(id) => {
          // A face keeps its last value while it unmounts.
          const value = createMemo(
            (last: T) => morphFace(state(), id)?.value ?? last,
            morphFace(untrack(state), id)!.value,
          )

          const leaving = createMemo(() => isMorphFaceLeaving(state(), id))

          return (
            <div
              ref={(el) => {
                faceElements.set(id, el)

                const observer = new ResizeObserver((entries) => {
                  const size = entries[0]?.borderBoxSize[0]?.blockSize

                  if (size !== undefined) dispatch({ type: "face.measured", id, height: size })
                })

                observer.observe(el)
                onCleanup(() => {
                  observer.disconnect()
                  faceElements.delete(id)
                })

                if (current.status === "flying") paint(current, prefersReducedMotion())
              }}
              data-slot="composer-face"
              inert={leaving()}
              aria-hidden={leaving() || undefined}
              class="shrink-0"
              classList={{ "pointer-events-none": leaving() }}
            >
              {props.children(value)}
            </div>
          )
        }}
      </For>
    </div>
  )
}

// A face coming in eases its opacity in late. A face going out stays opaque until only the fade-out tail of its box is
// left, then fades, so it is gone just as its box closes. Positional arguments: this runs for every face every frame.
function styleFace(
  el: HTMLElement,
  content: HTMLElement,
  p: number,
  dy: number,
  out: boolean,
  hidden: number,
  reduced: boolean,
) {
  el.style.opacity = `${(out ? Math.min(1, p / fadeTail()) : p * p).toFixed(4)}`

  // Movement, blur and the soft edge go on the content inside the clipping box, never on the box itself, so a blur
  // can't bleed past it. Before the content mounts there is nothing to move.
  if (reduced || content === el) return
  content.style.transform = `translateY(${((1 - p) * dy).toFixed(2)}px)`
  content.style.filter = p < 0.999 && blur() > 0 ? `blur(${((1 - p) * blur()).toFixed(2)}px)` : ""
  content.style.maskImage =
    hidden > 0 ? `linear-gradient(to top, transparent ${hidden}px, #000 ${hidden + Math.min(24, hidden)}px)` : ""
}

// Mounts its children when `when` turns truthy and grows them in; when it turns falsy they close and unmount. With
// `instant` they mount and unmount at once.
export function Grow<T>(props: {
  when: T | undefined | null | false
  instant?: boolean
  appear?: boolean
  fade?: boolean
  card?: boolean
  class?: string
  /** The spring it closes on, when it closes alongside other motion that should share it. */
  close?: () => DurationOptions
  onClosed?: () => void
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element)
}) {
  // Read once, on mount, as a caller may compute it with a side effect (the queue's `appearing.delete(id)`).
  const appear = !!props.when && !!props.appear
  let current = createGrowState(!!props.when)
  const [state, setState] = createSignal(current)
  // SAFETY: a truthy `when` is neither null nor undefined.
  const item = createMemo((prev?: NonNullable<T>) => (props.when ? (props.when as NonNullable<T>) : prev))
  const frame = { type: "frame" as const, attempt: 0, dt: 0, dpr: 1 }
  let el: HTMLDivElement | undefined
  let stopFrame: (() => void) | undefined
  let observer: ResizeObserver | undefined

  const dispatch = (event: GrowEvent) => {
    const previous = current
    const next = transitionGrow(previous, event)

    if (next === previous) return
    current = next

    if (isGrowMoving(previous) && (!isGrowMoving(next) || next.attempt !== previous.attempt)) {
      stopFrame?.()
      stopFrame = undefined
      observer?.disconnect()
      observer = undefined

      if (el) finish(el)
    }

    if (next.status === "disposed") return
    setState(next)

    if (didGrowClose(previous, next)) props.onClosed?.()
  }

  // Runs after the render, so a flight from `absent` finds its wrapper mounted.
  const start = (flight: Extract<GrowState, { status: "opening" | "closing" }>) => {
    const attempt = flight.attempt

    if (!el?.isConnected) return dispatch({ type: "detached", attempt })
    const target = el
    const reduced = prefersReducedMotion()
    target.toggleAttribute("data-moving", true)
    target.toggleAttribute("data-dock-border-underlay", flight.card)

    // Writes only until the first frame: a grow usually starts inside an input handler that has just changed the DOM,
    // where a read would force a layout that the frame then repeats.
    if (flight.status === "opening" && !reduced) target.style.height = "0px"

    if (flight.status === "opening" && (flight.fade || reduced)) target.style.opacity = "0"
    const child = target.firstElementChild instanceof HTMLElement ? target.firstElementChild : undefined

    // The content's height is read once, on the first frame, then kept current by a ResizeObserver rather than read
    // every frame.
    observer = new ResizeObserver((entries) => {
      const size = entries[0]?.borderBoxSize[0]?.blockSize

      if (size !== undefined) dispatch({ type: "resized", attempt, size })
    })

    if (child) observer.observe(child)

    // Runs in the frame loop's read phase, before any of the frame's writes.
    const measure = () => {
      if (!isGrowMoving(current) || current.attempt !== attempt || current.measured || !target.isConnected) return
      const marginBelow = parseFloat(getComputedStyle(target).marginBottom) || 0
      const margin = child ? parseFloat(getComputedStyle(child).marginBottom) || 0 : 0

      dispatch({
        type: "measured",
        attempt,
        marginBelow,
        marginAbove:
          (!marginBelow && target.previousElementSibling
            ? parseFloat(getComputedStyle(target.previousElementSibling).marginBottom)
            : 0) || 0,
        margin,
        full: child ? child.getBoundingClientRect().height + margin : 0,
        rendered: current.fromRendered ? target.getBoundingClientRect().height : 0,
      })
    }

    stopFrame = frameLoop.add((dt) => {
      if (!target.isConnected) {
        dispatch({ type: "detached", attempt })

        return false
      }

      frame.attempt = attempt
      frame.dt = dt
      frame.dpr = window.devicePixelRatio || 1
      dispatch(frame)

      if (!isGrowMoving(current) || current.attempt !== attempt) return false
      paintGrow(target, current, prefersReducedMotion())

      return true
    }, measure)
  }

  createEffect(
    on(
      () => [!!props.when, !!props.instant] as const,
      ([open, instant], previous) =>
        dispatch({
          type: "sync",
          open,
          appear: !previous && appear,
          instant,
          reduced: prefersReducedMotion(),
          fade: !!props.fade,
          card: !!props.card,
          curves: { open: morph(), close: props.close?.() ?? morph(), fadeIn: fadeIn() },
        }),
    ),
  )

  createEffect(
    on(state, () => {
      if (isGrowMoving(current) && !stopFrame) start(current)
    }),
  )

  onCleanup(observeReducedMotion(() => prefersReducedMotion() && dispatch(REDUCED_GROW_EVENT)))
  onCleanup(() => dispatch(DISPOSED_GROW_EVENT))

  const mounted = createMemo(() => isGrowMounted(state()))
  const interactive = createMemo(() => isGrowInteractive(state()))

  return (
    <Show when={mounted()}>
      <div
        ref={el}
        inert={!interactive()}
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

function paintGrow(el: HTMLElement, flight: Extract<GrowState, { status: "opening" | "closing" }>, reduced: boolean) {
  if (flight.margin < 0) el.style.overflowClipMargin = `${-flight.margin}px`

  if (!reduced) {
    // Written every frame, never read back: neighbours and the timeline inset follow the real height (as in #57559).
    el.style.height = `${flight.height}px`

    if (flight.marginBelow > 0) el.style.marginBottom = `${flight.marginBottom}px`

    if (flight.marginAbove > 0) el.style.marginTop = `${flight.marginTop}px`
  }

  if (!flight.fade && !reduced) return
  const open = flight.status === "opening"
  const content = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el
  styleFace(el, content, flight.progress, open ? 4 : 0, !open, flight.hidden, reduced)
}

function finish(el: HTMLElement) {
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

import { createMemo, createSignal, Index, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Option, Schema } from "effect"
import { createRemoteControls, type ControlDescriptor, type State, type Value } from "knobs"
import { KnobsPanel } from "knobs/solid"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { springStyle } from "@opencode/ui/motion/solid"
import { motionPresets, motionTuning, type MotionKnob } from "@opencode/ui/motion-tuning"
import {
  activeFeaturePreset,
  applyFeaturePreset,
  featureChanged,
  featureControls,
  featurePresets,
  motionFeatures,
  reset,
  resetFeature,
  type MotionFeature,
} from "@opencode/ui/motion-tuning-features"
import { applyMotion } from "@opencode/ui/motion-tuning-fields"
import { usePlugin } from "@opencode/plugin/gui"
import {
  createMotionState,
  MOTION_WIDE_AT,
  selectMotionFeature,
  selectMotionHeld,
  selectMotionIdle,
  selectMotionPushed,
  selectMotionSelected,
  selectMotionWide,
  transitionMotion,
  type MotionEffect,
  type MotionEvent,
  type MotionHandle,
} from "./motion-machine"

// Where the panel was dragged to, as an offset from its bottom-right home, its width, and the feature it last showed;
// kept per device.
const key = "opencode.motion.panel"

const SavedPanel = Schema.fromJsonString(
  Schema.Struct({
    x: Schema.optional(Schema.Number),
    y: Schema.optional(Schema.Number),
    width: Schema.optional(Schema.Number),
    feature: Schema.optional(Schema.String),
  }),
)

// The push between the list and a feature's page: no bounce, transform and opacity only.
const push = { omega: (2 * Math.PI) / 0.34, zeta: 1 }

/**
 * The Knobs panel, docked above the debug bar's right end until its header is dragged: a list of the app's features
 * under their areas, each opening to a page with its presets, its controls on one grid, Replay, Focus and Reset. Wide
 * enough, the list and the page sit side by side.
 */
export default function Motion(props: { title: string; onClose: () => void }) {
  const ctx = usePlugin()
  let container!: HTMLDivElement
  const saved = load()
  // Where the panel sits, written straight to its style so a drag or resize never re-renders; `start*` and the bounds
  // are read once when a handle is pressed.
  const frame = {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    startX: 0,
    startY: 0,
    startWidth: 0,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  }
  const [motion, setMotion] = createSignal(
    createMotionState({ wide: saved.width >= MOTION_WIDE_AT, selected: saved.feature }),
  )
  const [stack, setStack] = createSignal<HTMLDivElement>()
  // The registry isn't reactive; this ticks on every registration and edit, including the debug bar's.
  const [live, setLive] = createSignal(0)
  const show = outline()

  const areas = createMemo(() => {
    live()

    return motionFeatures()
  })

  const features = () => areas().flatMap((area) => area.features)
  const wide = () => selectMotionWide(motion())
  const pushed = () => selectMotionPushed(motion())
  const feature = () => selectMotionFeature(motion(), features())

  const dispatch = (event: MotionEvent) => {
    const next = transitionMotion(motion(), event)

    if (next.state !== motion()) setMotion(next.state)
    next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(console.error))
  }

  const run = (effect: MotionEffect) => {
    if (effect.type === "save") return persist()

    if (effect.type === "close") return props.onClose()

    if (effect.type === "focus.page") {
      // Shown now rather than on the spring's next frame, so focus can land in the page.
      stack()?.removeAttribute("data-home")
      container.querySelector<HTMLElement>("[data-motion-page] button")?.focus({ preventScroll: true })
      return
    }

    if (effect.type === "focus.row") {
      container
        .querySelector<HTMLElement>(`[data-motion-feature="${CSS.escape(effect.key)}"]`)
        ?.focus({ preventScroll: true })
      return
    }

    if (effect.type === "focus.list") {
      const active = document.activeElement

      if (active !== document.body && !active?.closest("[data-motion-page]")) return
      container.querySelector<HTMLElement>("[data-motion-feature]")?.focus({ preventScroll: true })
      return
    }

    if (effect.type === "settle") return settle()

    if (effect.type === "outline.frame") return show.frame(effect.target)

    if (effect.type === "outline.focus") {
      document.querySelector(effect.target)?.scrollIntoView({ block: "nearest", inline: "nearest" })
      show.frame(effect.target)
      show.expire(() => dispatch({ type: "outline.expired", attempt: effect.attempt }), effect.delay)
      return
    }

    show.dispose()
  }

  onCleanup(
    motionTuning.subscribe(() => {
      setLive((value) => value + 1)
      const selected = selectMotionSelected(motion())
      dispatch({ type: "features.changed", present: features().some((item) => item.key === selected) })
    }),
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  springStyle(
    stack,
    () => ({ push: pushed() ? 1 : 0 }),
    (element, value) => {
      element.style.setProperty("--push", `${value.push}`)
      element.toggleAttribute("data-home", value.push === 0 && !pushed())
    },
    push,
  )

  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    dispatch({ type: "escape" })
  }

  const place = () => (container.style.transform = `translate(${frame.x}px, ${frame.y}px)`)

  // Moves by at most what keeps the whole panel in the window, reading layout once rather than every frame.
  const bound = () => {
    const rect = container.getBoundingClientRect()
    frame.minX = frame.x - rect.left
    frame.maxX = Math.max(frame.minX, frame.x + window.innerWidth - rect.right)
    frame.minY = frame.y - rect.top
    frame.maxY = Math.max(frame.minY, frame.y + window.innerHeight - rect.bottom)
  }

  const moveTo = (x: number, y: number) => {
    frame.x = Math.min(Math.max(x, frame.minX), frame.maxX)
    frame.y = Math.min(Math.max(y, frame.minY), frame.maxY)
    place()
  }

  const settle = () => {
    bound()
    moveTo(frame.x, frame.y)
    persist()
  }

  const persist = () => save({ x: frame.x, y: frame.y, width: frame.width, feature: selectMotionSelected(motion()) })

  // The header drags the panel and the left edge resizes it, the right edge staying where it is. One pointer at a time.
  const press = (handle: MotionHandle, event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (handle === "header" && event.target instanceof Element && event.target.closest("button")) return
    dispatch({ type: "pointer.down", handle, pointerId: event.pointerId, button: event.button })

    if (!selectMotionHeld(motion(), handle, event.pointerId)) return
    event.preventDefault()
    bound()
    frame.startX = handle === "header" ? event.clientX - frame.x : event.clientX
    frame.startY = event.clientY - frame.y
    frame.startWidth = frame.width
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  // Runs per pointer move: no allocation and no signal write unless the panel crosses the wide breakpoint.
  const drag = (handle: MotionHandle, event: PointerEvent) => {
    if (!selectMotionHeld(motion(), handle, event.pointerId)) return

    if (handle === "header") return moveTo(event.clientX - frame.startX, event.clientY - frame.startY)
    frame.width = Math.round(
      Math.min(Math.max(320, frame.startWidth + frame.startX - event.clientX), window.innerWidth - 24),
    )
    container.style.width = `${frame.width}px`

    if ((frame.width >= MOTION_WIDE_AT) !== wide()) dispatch({ type: "resized", wide: frame.width >= MOTION_WIDE_AT })
  }

  // Lost capture also covers a capture taken away, so a gesture always ends; the first of the three wins.
  const release = (event: PointerEvent) => dispatch({ type: "pointer.released", pointerId: event.pointerId })

  onMount(() => {
    place()
    // A gesture settles once it ends rather than on every frame of a resize.
    const resized = () => {
      if (selectMotionIdle(motion())) settle()
    }
    const observer = new ResizeObserver(resized)
    observer.observe(container)
    window.addEventListener("resize", resized)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", resized)
    })
  })

  const list = () => (
    <div class="pb-3">
      <Index each={areas()}>
        {(area) => (
          <section>
            <h3 class="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-v2-text-text-faint">
              {area().area}
            </h3>
            <Index each={area().features}>
              {(item) => (
                <button
                  type="button"
                  data-motion-feature={item().key}
                  aria-current={wide() && feature()?.key === item().key ? "page" : undefined}
                  class="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_16px_16px] items-center gap-x-2 border-t border-v2-border-border-muted px-4 py-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus aria-[current=page]:bg-v2-overlay-simple-overlay-hover"
                  onPointerEnter={() => dispatch({ type: "row.entered", target: item().target })}
                  onPointerLeave={() => dispatch({ type: "row.left" })}
                  onClick={() => dispatch({ type: "feature.opened", key: item().key })}
                >
                  <span class="min-w-0">
                    <span class="flex items-baseline gap-2 text-[14px] font-medium leading-5 text-v2-text-text-base">
                      <span class="truncate">{item().name}</span>
                      <Show when={item().switch?.value === false}>
                        <span class="text-[11px] font-medium text-v2-text-text-faint">{ctx.t("motion.off")}</span>
                      </Show>
                      <Show when={item().modes.find((mode) => mode.value)}>
                        {(mode) => <span class="text-[11px] font-medium text-v2-text-text-faint">{mode().label}</span>}
                      </Show>
                    </span>
                    <Show when={item().description}>
                      {(description) => (
                        <span class="block truncate text-[12px] leading-[18px] text-v2-text-text-faint">
                          {description()}
                        </span>
                      )}
                    </Show>
                  </span>
                  <span class="grid size-4 place-items-center">
                    <Show when={featureChanged(item())}>
                      <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" />
                    </Show>
                  </span>
                  <Show when={!wide()} fallback={<span />}>
                    <Icon name="outline-chevron-right" size="small" class="text-v2-icon-icon-faint rtl:-scale-x-100" />
                  </Show>
                </button>
              )}
            </Index>
          </section>
        )}
      </Index>
    </div>
  )

  const page = () => (
    <Show when={feature()}>
      {(item) => (
        <FeaturePage
          feature={item()}
          live={live}
          back={wide() ? undefined : () => dispatch({ type: "back" })}
          onFocus={(target) => dispatch({ type: "target.focused", target })}
        />
      )}
    </Show>
  )

  return (
    <Portal>
      <div
        ref={(element) => {
          container = element
          element.style.width = `${frame.width}px`
        }}
        class="pointer-events-auto fixed bottom-10 right-3 z-50 flex h-[min(600px,calc(100vh-6rem))] flex-col overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-floating)]"
        onKeyDown={escape}
      >
        <div
          class="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize touch-none"
          aria-hidden="true"
          onPointerDown={(event) => press("edge", event)}
          onPointerMove={(event) => drag("edge", event)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        />
        <header
          class="flex h-10 shrink-0 cursor-grab touch-none items-center justify-between gap-2 border-b border-v2-border-border-muted ps-4 pe-1.5"
          onPointerDown={(event) => press("header", event)}
          onPointerMove={(event) => drag("header", event)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          <h2 class="text-[13px] font-semibold leading-5">{props.title}</h2>
          <IconButton
            size="small"
            variant="ghost-muted"
            icon={<Icon name="close" />}
            aria-label={ctx.t("motion.close")}
            onClick={() => props.onClose()}
          />
        </header>
        <Show
          when={!wide()}
          fallback={
            <div class="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
              <div class="min-h-0 overflow-y-auto border-e border-v2-border-border-muted">{list()}</div>
              <div class="min-h-0 overflow-y-auto">{page()}</div>
            </div>
          }
        >
          <div
            ref={setStack}
            class="group/stack relative min-h-0 flex-1 overflow-hidden [--dir:1] rtl:[--dir:-1]"
            data-home=""
          >
            <div
              class="absolute inset-0 overflow-y-auto"
              inert={pushed()}
              style={{
                transform: "translateX(calc(var(--push, 0) * -30% * var(--dir)))",
                opacity: "calc(1 - var(--push, 0) * 0.6)",
              }}
            >
              {list()}
            </div>
            <div
              data-motion-page=""
              class="absolute inset-0 overflow-y-auto bg-v2-background-bg-base group-data-[home]/stack:invisible"
              inert={!pushed()}
              style={{ transform: "translateX(calc((1 - var(--push, 0)) * 100% * var(--dir)))" }}
            >
              {page()}
            </div>
          </div>
        </Show>
      </div>
    </Portal>
  )
}

function FeaturePage(props: {
  feature: MotionFeature
  live: () => number
  back?: () => void
  onFocus: (target: string) => void
}) {
  // knobs fixes a store's presets when it's made, so a new store is made whenever the rows, the mode or the replays
  // change.
  const rows = createMemo(
    () => {
      props.live()

      return {
        feature: props.feature,
        mode: props.feature.modes.find((item) => item.value),
        controls: featureControls(props.feature),
      }
    },
    undefined,
    {
      equals: (a, b) =>
        !!a &&
        a.feature.key === b.feature.key &&
        a.feature.switch === b.feature.switch &&
        a.mode === b.mode &&
        same(a.controls, b.controls) &&
        same(a.feature.actions, b.feature.actions),
    },
  )

  return (
    <div class="pb-3">
      <Show when={props.back}>
        {(back) => (
          <button
            type="button"
            class="flex h-9 items-center gap-0.5 ps-2.5 pe-3 text-[13px] font-medium text-v2-text-text-muted hover:text-v2-text-text-base"
            onClick={() => back()()}
          >
            <Icon name="outline-chevron-right" size="small" class="-scale-x-100 rtl:scale-x-100" />
            <span>{props.feature.area}</span>
          </button>
        )}
      </Show>
      <h3 classList={{ "px-4 text-[15px] font-semibold leading-5": true, "pt-3": !props.back }}>
        {props.feature.name}
      </h3>
      <Show when={props.feature.description}>
        {(description) => <p class="px-4 text-[12px] leading-[18px] text-v2-text-text-muted">{description()}</p>}
      </Show>
      <Show when={rows()} keyed>
        {(shown) => (
          <FeatureKnobs
            feature={shown.feature}
            mode={shown.mode}
            controls={shown.controls}
            live={props.live}
            onFocus={props.onFocus}
          />
        )}
      </Show>
    </div>
  )
}

/**
 * A feature's knobs as one embedded knobs group bound to the registry: Replay and Focus beside its reset and die, its
 * presets, and its rows. Choosing a preset goes through the feature model, so a mode turns on as it does from
 * anywhere else.
 */
function FeatureKnobs(props: {
  feature: MotionFeature
  mode?: MotionKnob
  controls: MotionKnob[]
  live: () => number
  onFocus: (target: string) => void
}) {
  const ctx = usePlugin()
  const feature = props.feature
  const group = feature.key
  const toggle = feature.switch
  const knobs = [...(toggle ? [toggle] : []), ...props.controls]
  const byId = new Map(knobs.map((item) => [item.id, item]))
  // While a mode is on, the spring presets don't move its springs; choosing one turns the mode off first.
  const springs = props.mode ? [] : props.controls.flatMap((item) => (item.kind === "spring" ? [item] : []))
  const presets = featurePresets(feature).filter((preset) => preset !== "shipped")

  const preset = (id: string): State => {
    if (id !== "snappy" && id !== "smooth" && id !== "calm") return {}

    return Object.fromEntries(springs.map((item) => [item.id, { ...item.presets[id] }]))
  }

  const target = feature.target

  const groupActions = () => [
    // One trigger is Replay; several replay on their own, each named for what it moves.
    ...feature.actions.map((item) => ({
      label: feature.actions.length === 1 ? ctx.t("motion.replay") : item.label,
      icon: "retrigger",
      run: () => item.run(),
    })),
    ...(target ? [{ label: ctx.t("motion.focus"), icon: "target", run: () => props.onFocus(target) }] : []),
  ]

  // Everything but the switch dims while it's off.
  const off = toggle ? (values: State) => values[toggle.id] === false : undefined

  const descriptors = knobs.map((item) =>
    item === toggle ? descriptor(item, group, ctx.t("motion.enabled")) : descriptor(item, group, item.label, off),
  )

  const values = () => {
    props.live()

    return Object.fromEntries(knobs.map((item) => [item.id, item.value]))
  }

  const set = (key: string, value: Value | null) => {
    const item = byId.get(key)

    // With nullDefaults off, null never arrives; resets reach onReset.
    if (!item || value === null) return

    // SAFETY: each key's descriptor was made from its knob, so knobs sends that knob's kind of value.
    applyMotion(item, value as MotionKnob["value"])
  }

  const controls = createRemoteControls(`opencode-motion-${group}`, descriptors, {
    values: values(),
    // Beta is a production build, where knobs resolves its production entry: the panel mounts only when shipped.
    ship: () => import("knobs/panel"),
    nullDefaults: false,
    echo: 0,
    persist: "none",
    storage: null,
    defaultLabel: ctx.t("motion.shipped"),
    groupLabels: { [group]: feature.name },
    presetLabels: { ...motionPresets, ...Object.fromEntries(feature.modes.map((item) => [item.id, item.label])) },
    scopedPresets:
      presets.length > 0 ? { [group]: Object.fromEntries(presets.map((id) => [id, preset(id)])) } : undefined,
    onSet: set,
    onSetBatch: (changes) => changes.forEach((change) => set(change.key, change.value)),
    // A group's reset is the feature's, modes included.
    onReset: (scope) => {
      if (!scope.key) return resetFeature(feature)

      const item = byId.get(scope.key)

      if (item) reset(item)
    },
  })

  // Shows the preset the registry is on: a mode, or what its values match.
  const current = activeFeaturePreset(feature)

  if (current && current !== "shipped" && presets.includes(current)) controls.preset(current, { scope: group })

  let chosen = controls.activePreset(group)?.id

  // A chip chosen in the strip applies through the feature model, which turns modes on and off.
  onCleanup(
    controls.subscribe(() => {
      const next = controls.activePreset(group)?.id

      if (next === chosen) return

      chosen = next

      // The Shipped chip clears the scope's active preset.
      applyFeaturePreset(feature, next ?? "shipped")
    }),
  )

  return (
    // Inset so the rows' labels line up with the page's title.
    <div class="px-2 pt-1">
      <KnobsPanel
        controls={controls}
        values={values()}
        theme={document.documentElement.dataset.colorScheme === "light" ? "light" : "dark"}
        embed
        surface="flat"
        groups={[group]}
        groupActions={groupActions}
        hints="panel"
        session={false}
      />
    </div>
  )
}

function descriptor(
  item: MotionKnob,
  group: string,
  label = item.label,
  disabled?: (values: State) => boolean,
): ControlDescriptor {
  // Experiments are the design under test, not tuning: presets leave them be.
  const meta = {
    key: item.id,
    label,
    group,
    description: item.description,
    inPresets: item.experiment ? (false as const) : undefined,
    disabled,
  }

  if (item.kind === "number")
    return {
      ...meta,
      kind: "number",
      default: item.initial,
      min: item.min,
      max: item.max,
      step: item.step,
      unit: item.unit,
    }

  if (item.kind === "choice")
    return {
      ...meta,
      kind: "choice",
      default: item.initial,
      choices: item.options.map((option) => ({ id: option, label: item.labels[option] ?? option })),
    }

  if (item.kind === "toggle" || item.kind === "mode") return { ...meta, kind: "toggle", default: item.initial }

  if (item.kind === "spring") return { ...meta, kind: "spring", default: { ...item.initial } }

  return { ...meta, kind: "easing", default: [...item.initial] }
}

// Frames the part of the app a feature changes: a pointer-transparent outline that fades in and out. Its rects are read
// once per change of target, never per frame. The machine decides what is framed; this only draws it, and owns the
// timers that fade frames out and end a Focus.
function outline() {
  const frames: HTMLElement[] = []
  const leaving = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
  const focus: { timer?: ReturnType<typeof setTimeout> } = {}

  const clear = () =>
    frames.splice(0).forEach((frame) => {
      frame.style.opacity = "0"
      leaving.set(
        frame,
        setTimeout(() => {
          leaving.delete(frame)
          frame.remove()
        }, 200),
      )
    })

  return {
    frame: (target: string | undefined) => {
      clear()

      if (!target) return

      document.querySelectorAll(target).forEach((element) => {
        const rect = element.getBoundingClientRect()

        if (rect.width === 0 || rect.height === 0) return
        const frame = document.body.appendChild(document.createElement("div"))

        frame.style.cssText = `position:fixed;z-index:60;pointer-events:none;opacity:0;transition:opacity .15s;border-radius:6px;
          left:${rect.left - 3}px;top:${rect.top - 3}px;width:${rect.width + 6}px;height:${rect.height + 6}px;
          border:1.5px solid var(--v2-border-border-focus);background:color-mix(in srgb, var(--v2-border-border-focus) 10%, transparent)`
        requestAnimationFrame(() => (frame.style.opacity = "1"))
        frames.push(frame)
      })
    },
    // A newer Focus replaces the timer; an older one that fires anyway is ignored by its attempt.
    expire: (done: () => void, delay: number) => {
      clearTimeout(focus.timer)
      focus.timer = setTimeout(done, delay)
    },
    dispose: () => {
      clearTimeout(focus.timer)
      leaving.forEach((timer, frame) => {
        clearTimeout(timer)
        frame.remove()
      })
      leaving.clear()
      frames.splice(0).forEach((frame) => frame.remove())
    },
  }
}

function load() {
  const saved = Option.getOrUndefined(
    Schema.decodeUnknownOption(SavedPanel)(localStorage.getItem(key) ?? "{}"),
  )

  return { x: saved?.x ?? 0, y: saved?.y ?? 0, width: saved?.width || 360, feature: saved?.feature || undefined }
}

function save(state: { x: number; y: number; width: number; feature: string | undefined }) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {}
}

function same<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

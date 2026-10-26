// Kept on purpose: the review tour is how Kit reviews features in context, in the running app with each stop set up
// for him. Cleanup and simplification passes must not delete it, even when nothing in a shipped build uses it.

import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { Option, Schema } from "effect"
import { createEffect, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useDialog } from "@opencode/ui/context/dialog"
import { base64Encode } from "@opencode/util/encode"
import { useExtensionHost } from "@/runtime/extension/host"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { formatServerError } from "@/runtime/server/errors"
import { useGlobal } from "@/runtime/server/runtime"
import { isExtensionTab, isRootTab } from "@/settings/route"
import { useSettings } from "@/settings/model"
import { useSettingsSurface } from "@/settings/surface"
import { isEditableTarget, useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { sessionHref } from "@/shell/routes/session"
import { useTabs } from "@/shell/tabs/tabs"
import { TourCard, TourPill, verdictPrompt, type TourStatus } from "./card"
import { StopKnobs } from "./knobs"
import { loadManifest, TourVerdict, type TourStop } from "./manifest"
import { arrive, stopScope, type StopScope, type TourApp } from "./setup"
import { selectorError, SpotlightRing } from "./spotlight"
import { motion, sprung } from "./spring"

const decodeDebug = Schema.decodeUnknownOption(Schema.Struct({ visible: Schema.Boolean, motion: Schema.Boolean }))

const TourState = Persistence.struct({
  manifest: Schema.String,
  stop: Schema.Finite,
  collapsed: Schema.Boolean,
  verdicts: Persistence.record(Persistence.optional(TourVerdict)),
})

/**
 * A review tour: a floater that walks through the stops of the manifest at `url`, setting the app up for each one, and
 * sends each verdict to the manifest's coordinator session as a queued prompt. Its keys are ⌥. and ⌥, for the next and
 * previous stop, and ⌥1–9 for a decision's options.
 */
export default function ReviewTour(props: { url: string; onEnd: () => void }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const command = useCommand()
  const dialog = useDialog()
  const settingsSurface = useSettingsSurface()
  const settings = useSettings()
  const tabs = useTabs()
  const extensions = useExtensionHost()
  const servers = useServers()
  const global = useGlobal()
  const [manifest] = createResource(() => props.url, loadManifest)

  const [state, setState, , ready] = persisted(Persist.global("review-tour"), TourState, {
    manifest: "",
    stop: 0,
    collapsed: false,
    verdicts: {},
  })

  const [view, setView] = createStore<{
    closed: boolean
    editing: boolean
    /** A verdict is on its way; its controls wait. */
    sending: boolean
    /** What went wrong on this stop; cleared on leaving it. */
    problem?: TourStatus
    flash?: TourStatus
    /** The pointer is over the floater, so its stop's spotlight shows. */
    hover: boolean
    selected: { [id: string]: number | undefined }
    rings: { key: number; selector: string; label: string; leaving: boolean }[]
  }>({ closed: false, editing: false, sending: false, hover: false, selected: {}, rings: [] })

  const tour = () => (manifest.state === "ready" && ready() && state.manifest === props.url ? manifest() : undefined)
  const count = () => tour()?.stops.length ?? 0
  const index = () => Math.min(Math.max(0, state.stop), count() - 1)
  const stop = () => (view.closed ? undefined : tour()?.stops[index()])

  // The debug extension's own store: whether its bar and Knobs panel show. A global store, so not a function of a session.
  const debugBar = () => {
    const bar = extensions.stores("debug")?.bar

    return bar && "ready" in bar ? bar : undefined
  }

  const healthy = () => servers.list.find((conn) => global.servers.health[ServerConnection.key(conn)]?.healthy)

  const app: TourApp = {
    navigate: (path) => navigate(path),
    serverSegment: () => {
      const conn = healthy()

      return conn && base64Encode(ServerConnection.key(conn))
    },
    sessionPath: (sessionID) => {
      const conn = healthy()

      return conn && sessionHref(ServerConnection.key(conn), sessionID)
    },
    openTab: (sessionID) => {
      const conn = healthy()

      if (conn) tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: sessionID })
    },
    settings: (tab) => {
      if (!isRootTab(tab) && !isExtensionTab(tab, settingsSurface.extensions.tabs())) return false
      settingsSurface.open(tab)

      return true
    },
    appearance: () =>
      settings.ready()
        ? { tabLayout: settings.appearance.tabLayout(), sidebarOpen: settings.appearance.sidebarOpen() }
        : undefined,
    setAppearance: (values) => {
      if (values.tabLayout !== undefined) settings.appearance.setTabLayout(values.tabLayout)

      if (values.sidebarOpen !== undefined) settings.appearance.setSidebarOpen(values.sidebarOpen)
    },
    debug: () => {
      const bar = debugBar()

      return bar?.ready() ? Option.getOrUndefined(decodeDebug(bar.value)) : undefined
    },
    setDebug: (state) => debugBar()?.set(state),
    palette: () => command.show(),
    dialogOpen: () => !!dialog.active,
    closeDialog: () => dialog.close(),
  }

  // A different tour starts from its first stop.
  createEffect(() => {
    if (!ready() || state.manifest === props.url) return
    setState({ manifest: props.url, stop: 0, verdicts: {} })
  })

  createEffect(() => {
    if (manifest.state !== "errored") return
    showToast({
      variant: "error",
      title: language.t("tour.loadFailed", { error: formatServerError(manifest.error, language.t) }),
    })
  })

  let ringKey = 0

  // The stop being set up and what it changed; its Knobs card mounts with it.
  const [arrival, setArrival] = createSignal<{ stop: TourStop; scope: StopScope; signal: AbortSignal }>()

  createEffect(
    on(stop, (current) => {
      const invalid = current?.spotlight === undefined ? undefined : selectorError(current.spotlight)

      setView(
        produce((draft) => {
          draft.editing = false
          draft.problem = undefined
          draft.rings.forEach((ring) => (ring.leaving = true))

          if (current?.spotlight && !invalid)
            draft.rings.push({ key: ++ringKey, selector: current.spotlight, label: current.id, leaving: false })
        }),
      )

      if (invalid) problem(invalid)

      if (!current) return

      const controller = new AbortController()
      const scope = stopScope(app)
      setArrival({ stop: current, scope, signal: controller.signal })

      arrive(current, app, scope, controller.signal)
        .then(() => {
          // A page that focuses its composer on arrival would keep the tour's keys; the palette's field is the point.
          const focused = document.activeElement

          if (current.palette === undefined && focused instanceof HTMLElement && isEditableTarget(focused))
            focused.blur()

          return showOption(current, scope, controller.signal)
        })
        .catch((error) => controller.signal.aborted || problem(formatServerError(error, language.t)))

      onCleanup(() => {
        controller.abort()
        setArrival(undefined)
        scope.restore()
      })
    }),
  )

  // A decision shows the option picked before, else whichever its knobs already hold.
  const showOption = async (current: TourStop, scope: StopScope, signal: AbortSignal) => {
    const options = current.options ?? []
    const verdict = state.verdicts[current.id]
    const picked = verdict?.kind === "pick" ? options.findIndex((option) => option.label === verdict.option) : -1
    const remembered = view.selected[current.id] ?? (picked === -1 ? undefined : picked)

    if (remembered !== undefined) return select(remembered)

    const held = await Promise.all(options.map((option) => option.knobs && scope.holds(option.knobs, signal)))
    const holding = held.indexOf(true)

    if (holding !== -1 && !signal.aborted) setView("selected", current.id, holding)
  }

  const select = (option: number) => {
    const current = stop()
    const here = arrival()
    const values = current?.options?.[option]?.knobs

    if (!current?.options?.[option] || !here) return
    setView("selected", current.id, option)

    if (values)
      here.scope
        .knobs(values, here.signal)
        .catch((error) => here.signal.aborted || problem(formatServerError(error, language.t)))
  }

  // The set-up stop, when it has knobs or tweaks for the card above the floater.
  const tuning = () => {
    const here = arrival()

    return here?.stop.tune?.length || here?.stop.tweaks?.length ? here : undefined
  }

  const problem = (error: string) =>
    setView("problem", { kind: "problem", text: language.t("tour.problem", { error }) })

  const go = (by: number) => {
    const next = index() + by

    if (next < 0 || next >= count()) return
    setState("stop", next)
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined

  const flash = (status: TourStatus) => {
    clearTimeout(flashTimer)
    setView("flash", status)
    flashTimer = setTimeout(() => setView("flash", undefined), 2400)
  }

  onCleanup(() => clearTimeout(flashTimer))

  const send = (verdict: TourVerdict) => {
    const current = stop()
    const coordinator = tour()?.coordinator

    if (!current || view.sending) return

    setView("editing", false)

    const record = (text: string) => {
      setState("verdicts", current.id, verdict)
      flash({ kind: "sent", text: `${current.id} · ${text}` })

      if (stop() === current) go(1)
    }

    if (!coordinator) return record(language.t("tour.recorded"))

    const conn = healthy()

    // A failure stays on its stop until it's left or sent again.
    const fail = (error: string) => setView("problem", { kind: "failed", text: language.t("tour.failed", { error }) })

    if (!conn) return fail(language.t("tour.noServer"))

    clearTimeout(flashTimer)
    setView({ sending: true, problem: undefined, flash: { kind: "sending", text: language.t("tour.sending") } })
    global
      .ensureServerCtx(conn)
      .sdk.api.session.prompt({ sessionID: coordinator, text: verdictPrompt(current.id, verdict), delivery: "queue" })
      .then(
        () => {
          setView("sending", false)
          record(language.t("tour.sent"))
        },
        (error) => {
          setView({ sending: false, flash: undefined })
          fail(formatServerError(error, language.t))
        },
      )
  }

  makeEventListener(
    window,
    "keydown",
    (event) => {
      // ⌥ types characters on macOS, so fields keep their keys; the floater's own buttons move from anywhere else.
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || !stop()) return

      if (isEditableTarget(event.target)) return

      const digit = Number(/^Digit([1-9])$/.exec(event.code)?.[1])

      const action =
        event.code === "Period"
          ? () => go(1)
          : event.code === "Comma"
            ? () => go(-1)
            : digit && stop()?.options
              ? () => select(digit - 1)
              : undefined

      if (!action) return
      event.preventDefault()
      event.stopImmediatePropagation()
      action()
    },
    { capture: true },
  )

  // The window title names the stop, so a screen recording's title says where it was.
  const title = document.title

  createEffect(() => {
    const current = stop()

    document.title = current ? `${current.id} · ${current.title}` : title
  })
  onCleanup(() => (document.title = title))

  return (
    <Portal>
      <For each={view.rings}>
        {(ring) => (
          <SpotlightRing
            selector={ring.selector}
            label={ring.label}
            hold={view.hover}
            leaving={ring.leaving}
            onGone={() => setView("rings", (rings) => rings.filter((item) => item.key !== ring.key))}
          />
        )}
      </For>
      <Show when={stop()}>
        {(current) => (
          <Floater
            collapsed={state.collapsed}
            onCollapsed={(collapsed) => setState("collapsed", collapsed)}
            onHover={(hover) => setView("hover", hover)}
            knobs={
              <Show when={tuning()} keyed>
                {(here) => <StopKnobs stop={here.stop} scope={here.scope} onProblem={problem} />}
              </Show>
            }
            card={(grab) => (
              <TourCard
                stop={current()}
                position={index() + 1}
                count={count()}
                verdict={state.verdicts[current().id]}
                selected={view.selected[current().id]}
                status={view.problem ?? view.flash}
                editing={view.editing}
                busy={view.sending}
                coordinator={!!tour()?.coordinator}
                onEdit={(editing) => {
                  // A modal palette would keep the note field from taking focus.
                  if (editing && dialog.active) dialog.close()
                  setView("editing", editing)
                }}
                onPrevious={() => go(-1)}
                onNext={() => go(1)}
                onSelect={select}
                onVerdict={send}
                onCollapse={() => setState("collapsed", true)}
                onClose={() => {
                  setView("closed", true)
                  props.onEnd()
                }}
                onGrab={grab}
              />
            )}
            pill={(grab) => <TourPill stop={current()} position={index() + 1} count={count()} onGrab={grab} />}
          />
        )}
      </Show>
    </Portal>
  )
}

/**
 * The floater: bottom-right until it's dragged by its header or pill, then where it was dropped, kept per browser tab
 * and inside the window. The stop's Knobs card sits above it. Collapsing fades the card into a pill.
 */
function Floater(props: {
  collapsed: boolean
  onCollapsed: (collapsed: boolean) => void
  onHover: (hover: boolean) => void
  knobs: JSX.Element
  card: (grab: (event: PointerEvent) => void) => JSX.Element
  pill: (grab: (event: PointerEvent) => void) => JSX.Element
}) {
  let element!: HTMLDivElement
  let cardLayer!: HTMLDivElement
  let pillLayer!: HTMLDivElement
  const offset = { ...loadPosition() }

  const place = () => (element.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`)

  // The offsets that keep the whole floater in the window, reading layout once rather than every frame.
  const bounds = () => {
    const rect = element.getBoundingClientRect()

    return {
      x: [offset.x - rect.left + margin, offset.x + innerWidth - margin - rect.right],
      y: [offset.y - rect.top + margin, offset.y + innerHeight - margin - rect.bottom],
    }
  }

  const clamp = (limits: ReturnType<typeof bounds>, x: number, y: number) => {
    offset.x = Math.min(Math.max(x, limits.x[0]!), Math.max(limits.x[0]!, limits.x[1]!))
    offset.y = Math.min(Math.max(y, limits.y[0]!), Math.max(limits.y[0]!, limits.y[1]!))
    place()
  }

  // A resized window or a taller card moves the floater back inside.
  const settle = () => clamp(bounds(), offset.x, offset.y)

  const paintOpen = (open: number) => {
    cardLayer.style.opacity = String(open)
    cardLayer.style.transform = `scale(${0.96 + 0.04 * open})`
    pillLayer.style.opacity = String(1 - open)
    pillLayer.style.transform = `scale(${0.96 + 0.04 * (1 - open)})`
  }

  const open = sprung(props.collapsed ? 0 : 1, motion.settle, paintOpen)

  // No animation on load: the first paint is the resting state.
  onMount(() => {
    paintOpen(props.collapsed ? 0 : 1)
    place()
    const observer = new ResizeObserver(settle)
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })
  makeEventListener(window, "resize", settle)
  createEffect(
    on(
      () => props.collapsed,
      (collapsed) => open.set(collapsed ? 0 : 1),
      { defer: true },
    ),
  )
  onCleanup(() => open.dispose())

  const grab = (event: PointerEvent) => {
    if (event.button !== 0) return

    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) return

    const limits = bounds()
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y }
    let moved = false

    target.setPointerCapture(event.pointerId)

    const move = (next: PointerEvent) => {
      moved ||= Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 3

      if (moved) clamp(limits, next.clientX - start.x, next.clientY - start.y)
    }

    const up = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", up)
      target.removeEventListener("pointercancel", up)

      if (moved) return savePosition(offset)

      if (props.collapsed) props.onCollapsed(false)
    }

    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", up)
    target.addEventListener("pointercancel", up)
  }

  return (
    <div
      ref={element}
      data-component="review-tour"
      class="pointer-events-none fixed right-4 bottom-4 z-[2147483000] flex flex-col items-end gap-2"
      onPointerOver={() => props.onHover(true)}
      onPointerOut={(event) => {
        if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) props.onHover(false)
      }}
    >
      <div class="pointer-events-auto" classList={{ hidden: props.collapsed }}>
        {props.knobs}
      </div>
      <div class="grid items-end justify-items-end">
        <div
          ref={cardLayer}
          class="origin-bottom-right [grid-area:1/1]"
          classList={{ "pointer-events-auto": !props.collapsed }}
          inert={props.collapsed}
        >
          {props.card(grab)}
        </div>
        <div
          ref={pillLayer}
          class="origin-bottom-right [grid-area:1/1]"
          classList={{ "pointer-events-auto": props.collapsed }}
          inert={!props.collapsed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") props.onCollapsed(false)
          }}
        >
          {props.pill(grab)}
        </div>
      </div>
    </div>
  )
}

// The floater keeps this far from the window's edges.
const margin = 8

// Where the floater was dropped, as an offset from its bottom-right home; kept per browser tab.
const positionKey = "opencode.tour.position"

const decodePosition = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
)

function loadPosition() {
  return Option.getOrElse(decodePosition(sessionStorage.getItem(positionKey)), () => ({ x: 0, y: 0 }))
}

function savePosition(offset: { x: number; y: number }) {
  sessionStorage.setItem(positionKey, JSON.stringify(offset))
}

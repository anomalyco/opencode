import { HoverCard } from "@kobalte/core/hover-card"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { createComputed, createSignal, For, onCleanup, Show, untrack, type JSXElement } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { createMediaQuery } from "@solid-primitives/media"
import {
  INITIAL_TAB_PREVIEW_STATE,
  selectTabPreviewFollowCard,
  selectTabPreviewInstant,
  selectTabPreviewOpenDelay,
  transitionTabPreview,
  type TabPreviewEffect,
  type TabPreviewEvent,
  type TabPreviewOwner,
  type TabPreviewState,
} from "./tab-popover-machine"
import "./tab-popover.css"

const CLOSE_DELAY = 0

// One preview is up at a time across every tab strip, so the machine is shared.
const [previewState, setPreviewState] = createSignal<TabPreviewState>(INITIAL_TAB_PREVIEW_STATE)

// In the vertical strip, the card follows the pointer's height over its row, clamped to the tabs, so moving down the
// tabs reads as one card following the cursor. The last pointer height over a row, and the rects the card clamps
// against, measured once per card.
let pointerY = 0

let rects: { row: DOMRect; bounds: DOMRect; card: number } | undefined

let measureFrame: number | undefined

let unwatch: (() => void) | undefined

let warmTimer: ReturnType<typeof setTimeout> | undefined

function dispatch(event: TabPreviewEvent) {
  const previous = untrack(previewState)
  const next = transitionTabPreview(previous, event)

  if (next.state !== previous) setPreviewState(next.state)
  next.effects.forEach(run)
}

function run(effect: TabPreviewEffect) {
  if (effect.type === "owner.close") return effect.owner.close()

  if (effect.type === "follow.start") return follow(effect.trigger, effect.card)

  if (effect.type === "follow.stop") {
    unwatch?.()
    unwatch = undefined

    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
    measureFrame = undefined
    rects = undefined

    return
  }

  clearTimeout(warmTimer)
  warmTimer = undefined

  if (effect.type === "warm.clear") return
  const attempt = effect.attempt
  warmTimer = setTimeout(() => dispatch({ type: "warm.expired", attempt }), effect.delayMs)
}

export interface TabPreviewData {
  projectName?: string
  title?: string
  path?: string
  serverName?: string
}

export function TabPreviewPopover(props: {
  trigger: JSXElement
  open: boolean
  onOpenChange: (open: boolean) => void
  data: TabPreviewData
  orientation?: "horizontal" | "vertical"
}) {
  const language = useLanguage()
  const mobile = createMediaQuery("(max-width: 767px)")
  let triggerEl: HTMLDivElement | undefined
  const owner: TabPreviewOwner = { close: () => props.onOpenChange(false) }
  const open = () => props.open && !mobile()

  // Observe accepted, controlled state, including drag/menu suppression in TabNav. A computed commits the preview
  // before Kobalte mounts the card, so the card's ref and `data-instant` already see it.
  createComputed(() => {
    const type = open() ? "preview.opened" : "preview.closed"
    untrack(() => dispatch({ type, owner }))
  })
  onCleanup(() => dispatch({ type: "owner.disposed", owner }))

  // Kept out of JSX: an inline nested ternary compiles to a memo created on every read, and Kobalte reads
  // placement from a ResizeObserver callback, where that memo has no owner and is never disposed.
  const placement = () =>
    props.orientation === "vertical" ? (language.direction() === "rtl" ? "left-start" : "right-start") : "bottom-start"

  return (
    <HoverCard
      open={open()}
      onOpenChange={props.onOpenChange}
      // Kobalte reads openDelay when the pointer enters the trigger, so a streak skips it per hover.
      openDelay={selectTabPreviewOpenDelay(previewState())}
      closeDelay={CLOSE_DELAY}
      // Informational previews belong to their tab, not to a hoverable safe area.
      ignoreSafeArea
      placement={placement()}
      gutter={6}
    >
      <HoverCard.Trigger
        ref={triggerEl}
        as="div"
        data-component="session-tab-popover-trigger"
        tabIndex={-1}
        onPointerMove={(event: PointerEvent) => {
          pointerY = event.clientY
          const card = selectTabPreviewFollowCard(previewState(), triggerEl)

          if (card && triggerEl) place(triggerEl, card)
        }}
      >
        {props.trigger}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          ref={(el) => {
            // Portalled content lives outside the themed subtree, so mirror the
            // active theme like the v2 tooltip does.
            const theme = triggerEl?.closest("[data-theme]")?.getAttribute("data-theme")

            if (theme) el.setAttribute("data-theme", theme)

            if (triggerEl && props.orientation === "vertical")
              dispatch({
                type: "follow.attached",
                owner,
                trigger: triggerEl,
                card: el,
                reducedMotion: prefersReducedMotion(),
              })
          }}
          data-component="session-tab-popover"
          // During a rapid tab-hopping streak the preview appears and disappears without animating; only the first,
          // cold preview animates, as browsers reuse one tab tooltip.
          data-instant={selectTabPreviewInstant(previewState()) || undefined}
        >
          <div data-slot="header">
            <Show when={props.data.projectName}>
              <span data-slot="project">{props.data.projectName}</span>
            </Show>
            <Show when={props.data.title}>
              <span data-slot="title">{props.data.title}</span>
            </Show>
          </div>

          <Show when={props.data.path}>
            {(path) => (
              <div data-slot="row">
                {/* Break after separators so long paths wrap between folder names, not mid-name. */}
                <span data-slot="detail">
                  <For each={path().split(/(?<=[\\/])/)}>
                    {(part) => (
                      <>
                        {part}
                        <wbr />
                      </>
                    )}
                  </For>
                </span>
              </div>
            )}
          </Show>

          <Show when={props.data.serverName}>
            <div data-slot="server">{props.data.serverName}</div>
          </Show>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard>
  )
}

function follow(trigger: HTMLElement, card: HTMLElement) {
  rects = undefined
  watch(trigger, card)
  place(trigger, card)

  // The card has no height while it mounts, so clamp again once it's laid out.
  if (rects) return
  measureFrame = requestAnimationFrame(() => {
    measureFrame = undefined
    place(trigger, card)
  })
}

// Moves the card straight to the pointer, with no spring.
function place(trigger: HTMLElement, card: HTMLElement) {
  if (!card.isConnected || prefersReducedMotion()) return
  card.style.transform = `translateY(${cursorOffset(trigger, card)}px)`
}

// Keeps the pointer level with the middle of the row-sized slot the card would sit in by default, so the offset is 0
// at the row's centre and runs continuously across row boundaries, clamped to the sidebar.
function cursorOffset(trigger: HTMLElement, card: HTMLElement) {
  const measured = rects ?? measure(trigger, card)

  // The card has no height until it's attached, so a measurement taken as it mounts isn't kept.
  if (measured.card > 0) rects = measured
  const top = pointerY - measured.row.height / 2
  const clamped = Math.min(Math.max(top, measured.bounds.top), measured.bounds.bottom - measured.card)

  return clamped - measured.row.top
}

function measure(trigger: HTMLElement, card: HTMLElement) {
  const bounds = (trigger.closest('[data-slot="vertical-tabs"]') ?? trigger).getBoundingClientRect()

  return { row: trigger.getBoundingClientRect(), bounds, card: card.offsetHeight }
}

// While a card is up, scrolling or resizing the tabs moves the rows under the cached rects, so measure again and
// re-clamp the card even if the pointer stays still.
function watch(trigger: HTMLElement, card: HTMLElement) {
  const refresh = () => {
    rects = undefined
    place(trigger, card)
  }

  const observer = new ResizeObserver(refresh)
  observer.observe(trigger.closest('[data-slot="vertical-tabs"]') ?? trigger)
  window.addEventListener("scroll", refresh, { capture: true, passive: true })
  window.addEventListener("resize", refresh, { passive: true })
  unwatch = () => {
    observer.disconnect()
    window.removeEventListener("scroll", refresh, { capture: true })
    window.removeEventListener("resize", refresh)
  }
}

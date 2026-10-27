import { HoverCard } from "@kobalte/core/hover-card"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { createEffect, createSignal, on, onCleanup, Show, type JSXElement } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { createMediaQuery } from "@solid-primitives/media"
import "./tab-popover.css"

// Initial hover delay before the preview appears, per design.
const OPEN_DELAY = 750

const CLOSE_DELAY = 0

// After a preview closes, hovering a neighbouring tab within this window skips
// the open delay — mirrors the tooltip's skipDelayDuration so moving across
// tabs doesn't re-wait the full delay each time.
const SKIP_WINDOW = 500

let lastClosedAt = 0

let activePreview: (() => void) | undefined

// In the vertical strip, the card follows the pointer's height over its row, clamped to the tabs, so moving down the
// tabs reads as one card following the cursor.
const follow: Follow = { pointerY: 0 }

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
  // When opened during a rapid tab-hopping streak, this preview appears and
  // disappears instantly (no repeated enter/exit animation) — only the first,
  // "cold" preview animates. Mirrors how browsers reuse one tab tooltip.
  const [instant, setInstant] = createSignal(false)

  const warm = () => !!activePreview || Date.now() - lastClosedAt < SKIP_WINDOW
  const open = () => props.open && !mobile()
  const close = () => props.onOpenChange(false)

  // Observe accepted, controlled state, including drag/menu suppression in TabNav.
  createEffect(() => {
    if (open()) {
      if (activePreview !== close) activePreview?.()
      activePreview = close

      return
    }

    if (activePreview !== close) return
    activePreview = undefined
    lastClosedAt = Date.now()
  })
  createEffect(
    on(
      open,
      (now, before) => {
        if (!before || now || !triggerEl || triggerEl !== follow.trigger) return
        unwatch()
        follow.card = undefined
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    if (follow.trigger === triggerEl) {
      unwatch()
      Object.assign(follow, { trigger: undefined, card: undefined })
    }

    if (activePreview !== close) return
    activePreview = undefined
    lastClosedAt = Date.now()
  })
  // Kobalte reads openDelay lazily when the pointer enters the trigger, so this
  // resolves the skip window per-hover.
  const resolveOpenDelay = () => (warm() ? 0 : OPEN_DELAY)

  const handleOpenChange = (open: boolean) => {
    if (open) setInstant(warm())
    props.onOpenChange(open)
  }

  // Kept out of JSX: an inline nested ternary compiles to a memo created on every read, and Kobalte reads
  // placement from a ResizeObserver callback, where that memo has no owner and is never disposed.
  const placement = () =>
    props.orientation === "vertical" ? (language.direction() === "rtl" ? "left-start" : "right-start") : "bottom-start"

  return (
    <HoverCard
      open={open()}
      onOpenChange={handleOpenChange}
      openDelay={resolveOpenDelay()}
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
          follow.pointerY = event.clientY

          if (props.orientation === "vertical" && triggerEl === follow.trigger) place()
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

            if (triggerEl && props.orientation === "vertical") show(el, triggerEl)
          }}
          data-component="session-tab-popover"
          data-instant={instant() || undefined}
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
            <div data-slot="row">
              <span data-slot="detail">{props.data.path}</span>
            </div>
          </Show>

          <Show when={props.data.serverName}>
            <div data-slot="server">{props.data.serverName}</div>
          </Show>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard>
  )
}

function show(card: HTMLElement, trigger: HTMLElement) {
  Object.assign(follow, { card, trigger, rects: undefined })
  unwatch()

  if (prefersReducedMotion()) return
  watch(trigger)
  place()

  // The card has no height while it mounts, so clamp again once it's laid out.
  if (!follow.rects) requestAnimationFrame(place)
}

// Moves the card straight to the pointer, with no spring.
function place() {
  const card = follow.card

  if (!card?.isConnected || prefersReducedMotion()) return
  card.style.transform = `translateY(${cursorOffset()}px)`
}

// Keeps the pointer level with the middle of the row-sized slot the card would sit in by default, so the offset is 0
// at the row's centre and runs continuously across row boundaries, clamped to the sidebar.
function cursorOffset() {
  const rects = follow.rects ?? measure()

  if (!rects) return 0

  // The card has no height until it's attached, so a measurement taken as it mounts isn't kept.
  if (rects.card > 0) follow.rects = rects
  const top = follow.pointerY - rects.row.height / 2
  const clamped = Math.min(Math.max(top, rects.bounds.top), rects.bounds.bottom - rects.card)

  return clamped - rects.row.top
}

function measure() {
  if (!follow.trigger || !follow.card) return
  const bounds = (follow.trigger.closest('[data-slot="vertical-tabs"]') ?? follow.trigger).getBoundingClientRect()

  return { row: follow.trigger.getBoundingClientRect(), bounds, card: follow.card.offsetHeight }
}

// While a card is up, scrolling or resizing the tabs moves the rows under the cached rects, so measure again and
// re-clamp the card even if the pointer stays still.
function watch(trigger: HTMLElement) {
  const refresh = () => {
    follow.rects = undefined
    place()
  }

  const observer = new ResizeObserver(refresh)
  observer.observe(trigger.closest('[data-slot="vertical-tabs"]') ?? trigger)
  window.addEventListener("scroll", refresh, { capture: true, passive: true })
  window.addEventListener("resize", refresh, { passive: true })
  follow.unwatch = () => {
    observer.disconnect()
    window.removeEventListener("scroll", refresh, { capture: true })
    window.removeEventListener("resize", refresh)
  }
}

function unwatch() {
  follow.unwatch?.()
  follow.unwatch = undefined
}

type Follow = {
  // The row whose preview is up, or closed last.
  trigger?: HTMLElement
  card?: HTMLElement
  // The last pointer height over a row, and the rects the card clamps against, measured once per card.
  pointerY: number
  rects?: { row: DOMRect; bounds: DOMRect; card: number }
  unwatch?: () => void
}

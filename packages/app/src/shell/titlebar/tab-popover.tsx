import { HoverCard } from "@kobalte/core/hover-card"
import { createComputed, createSignal, For, onCleanup, Show, untrack, type JSXElement } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { createMediaQuery } from "@solid-primitives/media"
import {
  INITIAL_TAB_PREVIEW_STATE,
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

let warmTimer: ReturnType<typeof setTimeout> | undefined

function dispatch(event: TabPreviewEvent) {
  const previous = untrack(previewState)
  const next = transitionTabPreview(previous, event)

  if (next.state !== previous) setPreviewState(next.state)
  next.effects.forEach(run)
}

function run(effect: TabPreviewEffect) {
  if (effect.type === "owner.close") return effect.owner.close()

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

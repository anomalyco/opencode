import { HoverCard } from "@kobalte/core/hover-card"
import { Show, type Accessor, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { Tab } from "@/shell/tabs/tabs"
import { TitlebarTabStrip } from "./tab-strip"

export function OpenTabsPopover(props: {
  trigger: (open: Accessor<boolean>) => JSX.Element
  tabs: Tab[]
  currentTab: Tab | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  blocked: boolean
  onHoverExit: () => void
  onSelect: (tab: Tab) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
}) {
  const language = useLanguage()
  let trigger!: HTMLDivElement

  return (
    <HoverCard
      open={props.open && !props.blocked}
      onOpenChange={(open) => props.onOpenChange(open && !props.blocked)}
      openDelay={300}
      closeDelay={200}
      placement="bottom-start"
      gutter={6}
      // Center the 16px favicon after 4px popup + 6px row padding on the 28px toggle.
      shift={-4}
    >
      <HoverCard.Trigger
        ref={trigger}
        as="div"
        role="presentation"
        tabIndex={-1}
        class="flex shrink-0"
        onPointerLeave={props.onHoverExit}
      >
        {props.trigger(() => props.open && !props.blocked)}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          as="nav"
          // HoverCard forwards these to its dismissable layer, but omits them from its public prop types.
          {...{
            onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
            onPointerDownOutside: (event: Event) => event.preventDefault(),
          }}
          ref={(element) => {
            const theme = trigger.closest("[data-theme]")?.getAttribute("data-theme")
            if (theme) element.setAttribute("data-theme", theme)
          }}
          data-slot="open-tabs-popover"
          aria-label={language.t("titlebar.tabs.open")}
          class="z-50 flex w-[300px] max-w-[calc(100dvw-24px)] max-h-[min(400px,calc(100dvh-80px))] flex-col overflow-hidden rounded-[8px] bg-v2-background-bg-deep p-1 shadow-[var(--v2-elevation-floating)] outline-none [app-region:no-drag]"
        >
          <Show
            when={props.tabs.length}
            fallback={
              <div class="px-2 py-1.5 text-[13px] leading-4 text-v2-text-text-muted">
                {language.t("titlebar.tabs.empty")}
              </div>
            }
          >
            <TitlebarTabStrip
              orientation="vertical"
              tabs={props.tabs}
              currentTab={props.currentTab}
              onNavigate={props.onSelect}
              onClose={props.onClose}
              onReorder={props.onReorder}
            />
          </Show>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard>
  )
}

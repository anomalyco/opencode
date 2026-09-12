import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import type { ParentProps } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

export function SummaryPopover(props: ParentProps<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const language = useLanguage()
  return (
    <Popover open={props.open} placement="bottom-end" gutter={2} overflowPadding={16} onOpenChange={props.onOpenChange}>
      <Popover.Anchor class="pointer-events-none absolute end-3 top-0 h-12 w-0" aria-hidden="true" />
      <Popover.Trigger
        as={IconButton}
        icon={<Icon name="window-analytics" />}
        variant="ghost-muted"
        size="large"
        state={props.open ? "pressed" : undefined}
        aria-label={language.t("session.summary.title")}
        aria-expanded={props.open}
      />
      <Popover.Portal>
        <Popover.Content
          class="z-50 max-h-[calc(100dvh-96px)] overflow-y-auto border-0 bg-transparent p-1 outline-none"
          aria-label={language.t("session.summary.title")}
        >
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

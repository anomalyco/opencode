import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { getFilename } from "@opencode-ai/util/path"
import { useSessionHistory, type SessionHistoryEntry } from "@/context/session-history"

export interface SessionPickerPopoverProps {
  onSelect: (entry: SessionHistoryEntry) => void
  triggerStyle?: JSX.CSSProperties
  triggerClass?: string
  ariaLabel: string
  emptyText: string
  headerText: string
  placement?: "top-start" | "top-end" | "top" | "bottom-start" | "bottom-end" | "bottom"
}

const RECENT_LIMIT = 10
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function relativeTime(at: number, now: number): string {
  const delta = Math.max(0, now - at)
  if (delta < MINUTE) return "just now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`
  return new Date(at).toLocaleDateString()
}

export function SessionPickerPopover(props: SessionPickerPopoverProps) {
  const history = useSessionHistory()
  const [open, setOpen] = createSignal(false)
  // Snapshot "now" once per popover open so timestamps don't churn while the
  // user is reading the list.
  const [openedAt, setOpenedAt] = createSignal(Date.now())

  const items = createMemo(() => history.recent(RECENT_LIMIT))

  const handleOpen = (next: boolean) => {
    if (next) setOpenedAt(Date.now())
    setOpen(next)
  }

  const choose = (entry: SessionHistoryEntry) => {
    setOpen(false)
    props.onSelect(entry)
  }

  return (
    <Popover
      open={open()}
      onOpenChange={handleOpen}
      placement={props.placement ?? "top-start"}
      gutter={6}
      triggerAs={IconButton}
      triggerProps={{
        type: "button",
        icon: "speech-bubble",
        variant: "ghost",
        iconSize: "normal",
        class: props.triggerClass ?? "size-7 shrink-0",
        style: props.triggerStyle,
        "aria-label": props.ariaLabel,
        "data-action": "prompt-session-history",
      }}
      class="w-[420px] max-w-[calc(100vw-40px)]"
    >
      <div class="flex flex-col gap-3">
        <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{props.headerText}</div>
        <Show
          when={items().length > 0}
          fallback={<div class="text-13-regular text-text-weak px-1 py-3">{props.emptyText}</div>}
        >
          <ul class="flex flex-col gap-0.5 -mx-1">
            <For each={items()}>
              {(entry) => {
                const projectName = () => getFilename(entry.directory) || entry.directory || "?"
                const titleText = () => entry.title?.trim() || `${entry.id.slice(0, 8)}…`
                const tooltip = () =>
                  `${entry.title || "(untitled)"}\n${entry.directory}\n${entry.id}`
                return (
                  <li>
                    <button
                      type="button"
                      class="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left text-12-regular hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
                      title={tooltip()}
                      onClick={() => choose(entry)}
                    >
                      <Icon name="speech-bubble" size="small" class="mt-0.5 shrink-0 text-icon-weak" />
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-13-medium text-text-strong">{titleText()}</div>
                        <div class="truncate text-12-regular text-text-weak">
                          {projectName()} · {relativeTime(entry.visitedAt, openedAt())}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </div>
    </Popover>
  )
}

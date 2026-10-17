import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * Lists the messages pinned in the current session. Selecting an entry scrolls the timeline to that
 * message; the trailing control removes the pin without leaving the menu.
 */
export function SessionPinnedMenu(props: {
  messageIDs: readonly string[]
  label: (messageID: string) => string | undefined
  onSelect: (messageID: string) => void
  onUnpin: (messageID: string) => void
}) {
  const language = useLanguage()

  return (
    <Show when={props.messageIDs.length > 0}>
      <Menu gutter={6} placement="bottom-end">
        <Menu.Trigger
          as={IconButton}
          icon={<Icon name="pin" />}
          variant="ghost-muted"
          size="large"
          class="shrink-0"
          aria-label={language.t("ui.message.pinnedMessages")}
        />
        <Menu.Portal>
          <Menu.Content class="w-80" aria-label={language.t("ui.message.pinnedMessages")}>
            <For each={props.messageIDs}>
              {(id) => (
                <Menu.Item class="group/pinned" onSelect={() => props.onSelect(id)}>
                  <Icon name="pin-filled" class="shrink-0 text-v2-icon-icon-muted" />
                  <span dir="auto" class="me-1.5 min-w-0 flex-1 truncate text-v2-text-text-muted">
                    {props.label(id) ?? id}
                  </span>
                  {/* The row selects on press, so the unpin button keeps its pointer events to itself. */}
                  <span class="hidden shrink-0 group-hover/pinned:flex group-data-[highlighted]/pinned:flex [@media(hover:none)]:flex">
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      tabIndex={-1}
                      icon={<Icon name="outline-xmark" />}
                      aria-label={language.t("ui.message.unpinMessage")}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onPointerUp={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onUnpin(id)
                      }}
                    />
                  </span>
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Show>
  )
}

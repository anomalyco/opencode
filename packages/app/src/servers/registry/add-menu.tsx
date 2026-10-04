import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { For, Show } from "solid-js"
import { useServerAddItems } from "@/runtime/extension/servers"
import { useLanguage } from "@/runtime/i18n/language"

/** The add-server button; extensions that add their own kinds of server turn it into a menu. */
export function AddServerMenu(props: { onAddServer: () => void; compact?: boolean }) {
  const language = useLanguage()
  const items = useServerAddItems()

  return (
    <Show
      when={items().length > 0}
      fallback={
        <Show
          when={props.compact}
          fallback={
            <Button variant="ghost-muted" icon="plus" onClick={props.onAddServer}>
              {language.t("dialog.server.add.button")}
            </Button>
          }
        >
          <IconButton
            variant="ghost-muted"
            size="small"
            icon={<Icon name="plus" />}
            aria-label={language.t("dialog.server.add.button")}
            onClick={props.onAddServer}
          />
        </Show>
      }
    >
      <Menu gutter={4} modal={false} placement="bottom-end">
        <Show
          when={props.compact}
          fallback={
            <Menu.Trigger as={Button} variant="ghost-muted" icon="plus">
              {language.t("dialog.server.add.button")}
            </Menu.Trigger>
          }
        >
          <Menu.Trigger
            as={IconButton}
            variant="ghost-muted"
            size="small"
            icon={<Icon name="plus" />}
            aria-label={language.t("dialog.server.add.button")}
          />
        </Show>
        <Menu.Portal>
          <Menu.Content>
            <Menu.Item onSelect={props.onAddServer}>{language.t("dialog.server.add.button")}</Menu.Item>
            <For each={items()}>{(item) => <Menu.Item onSelect={() => item.run()}>{item.title}</Menu.Item>}</For>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Show>
  )
}

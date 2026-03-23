import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"

export type OverflowItem = {
  id: string
  label: string
  icon: IconProps["name"]
  onClick: () => void
  active?: boolean
  visible: boolean
}

export function ToolbarOverflowMenu(props: { items: OverflowItem[] }) {
  const language = useLanguage()

  const hiddenItems = () => props.items.filter((item) => !item.visible)

  const hasOverflow = () => hiddenItems().length > 0

  return (
    <Show when={hasOverflow()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border shrink-0"
          aria-label={language.t("common.moreOptions")}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <For each={hiddenItems()}>
              {(item) => (
                <DropdownMenu.Item onSelect={item.onClick}>
                  <Icon name={item.icon} size="small" class="text-icon-weak" />
                  <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}

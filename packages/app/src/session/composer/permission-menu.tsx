import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { PermissionMode } from "@/settings/model"

export function SessionPermissionMenu(props: { mode: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const language = useLanguage()

  const options = () =>
    [
      {
        value: "ask",
        label: language.t("session.permissions.mode.ask"),
        description: language.t("session.permissions.mode.ask.description"),
      },
      {
        value: "auto",
        label: language.t("session.permissions.mode.auto"),
        description: language.t("session.permissions.mode.auto.description"),
      },
    ] satisfies { value: PermissionMode; label: string; description: string }[]

  return (
    <Menu placement="top-end" gutter={4} overflowPadding={24} modal={false}>
      <Menu.Trigger
        data-action="session-permission-mode"
        aria-label={language.t("session.permissions.mode.title")}
        class="flex h-6 min-w-0 max-w-full items-center gap-1 rounded-sm px-1.5 hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed"
      >
        <Icon
          name="shield"
          size="small"
          class={props.mode === "auto" ? "shrink-0 text-v2-icon-icon-accent" : "shrink-0 text-v2-icon-icon-muted"}
        />
        <span class="min-w-0 truncate">{options().find((option) => option.value === props.mode)?.label}</span>
        <Icon name="chevron-down" size="small" class="size-3 shrink-0 text-v2-icon-icon-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="w-[260px]">
          <Menu.Group>
            <Menu.GroupLabel>{language.t("session.permissions.mode.title")}</Menu.GroupLabel>
            <Menu.RadioGroup value={props.mode}>
              <For each={options()}>
                {(option) => (
                  <Menu.RadioItem
                    value={option.value}
                    closeOnSelect
                    class="!h-auto !py-1.5"
                    onSelect={() => props.onChange(option.value)}
                  >
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{option.label}</span>
                      <span class="text-[12px] leading-text-compact text-v2-text-text-faint">{option.description}</span>
                    </span>
                  </Menu.RadioItem>
                )}
              </For>
            </Menu.RadioGroup>
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

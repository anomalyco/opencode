import { For, Show, type JSX } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"

import { useCommand } from "@/context/command"
import { DESKTOP_MENU, desktopMenuVisible, type DesktopMenuAction, type DesktopMenuEntry } from "@/desktop-menu"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export function WindowsAppMenu(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
  variant?: "legacy" | "v2"
}) {
  let lastFocused: HTMLElement | undefined
  const language = useLanguage()

  const rememberFocus = () => {
    const active = document.activeElement
    lastFocused = active instanceof HTMLElement ? active : undefined
  }
  const commandDisabled = (id: string) => {
    const option = props.command.options.find((option) => option.id === id)
    if (!option) return true
    return option.disabled ?? false
  }
  const runCommand = (id: string) => {
    if (commandDisabled(id)) return
    props.command.trigger(id)
  }
  const runAction = (action: DesktopMenuAction) => {
    if (action.startsWith("edit.") && lastFocused?.isConnected) lastFocused.focus({ preventScroll: true })
    void props.platform.runDesktopMenuAction?.(action)
  }
  const runEntry = (entry: DesktopMenuEntry) => {
    if (entry.type === "separator") return
    if (entry.command) {
      runCommand(entry.command)
      return
    }
    if (entry.action) {
      runAction(entry.action)
      return
    }
    if (entry.href) props.platform.openExternal(entry.href)
  }

  return (
    <DropdownMenu gutter={4} modal={false} placement="bottom-start">
      <Show
        when={props.variant === "v2"}
        fallback={
          <DropdownMenu.Trigger
            as={IconButton}
            icon="menu"
            variant="ghost"
            class="titlebar-icon rounded-md shrink-0"
            aria-label={language.t("desktop.menu.ariaLabel")}
            onPointerDown={rememberFocus}
            onKeyDown={rememberFocus}
          />
        }
      >
        <div
          data-component="desktop-icon-button"
          class="flex h-7 w-9 shrink-0 items-center justify-center rounded-[6px] px-1"
        >
          <DropdownMenu.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="large"
            icon={<IconV2 name="menu" />}
            aria-label={language.t("desktop.menu.ariaLabel")}
            onPointerDown={rememberFocus}
            onKeyDown={rememberFocus}
          />
        </div>
      </Show>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="desktop-app-menu">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="desktop-app-menu-heading">OpenCode</DropdownMenu.GroupLabel>
            <For each={DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "windows"))}>
              {(menu) => (
                <DesktopMenuSubmenu label={language.t(menu.labelKey)}>
                  <For each={menu.items?.filter((entry) => desktopMenuVisible(entry, "windows"))}>
                    {(entry) => {
                      // Static menu data: an early return keeps the union narrowing a Show fallback would lose.
                      if (entry.type === "separator") return <DropdownMenu.Separator />
                      return (
                        <DesktopMenuItem
                          label={entry.labelKey ? language.t(entry.labelKey) : ""}
                          keybind={entry.command ? props.command.keybind(entry.command) : entry.accelerator?.windows}
                          disabled={entry.command ? commandDisabled(entry.command) : false}
                          onSelect={() => runEntry(entry)}
                        />
                      )
                    }}
                  </For>
                </DesktopMenuSubmenu>
              )}
            </For>
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function DesktopMenuSubmenu(props: { label: string; children: JSX.Element }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <span data-slot="dropdown-menu-item-label">{props.label}</span>
        <span data-slot="desktop-app-menu-chevron">
          <Icon name="chevron-right" size="small" />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent class="desktop-app-menu">{props.children}</DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

function DesktopMenuItem(props: { label: string; keybind?: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item disabled={props.disabled} onSelect={props.onSelect}>
      <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
      <Show when={props.keybind}>
        <span data-slot="desktop-app-menu-keybind">{props.keybind}</span>
      </Show>
    </DropdownMenu.Item>
  )
}

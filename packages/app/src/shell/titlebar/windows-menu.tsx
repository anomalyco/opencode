import { makeEventListener } from "@solid-primitives/event-listener"
import { createSignal, For, onMount, type JSX } from "solid-js"
import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"

import { matchKeybind, parseKeybind, useCommand } from "@/shell/commands/command"
import {
  DESKTOP_MENU,
  desktopMenuKey,
  desktopMenuVisible,
  desktopMenuWithPlugins,
  type DesktopMenu,
  type DesktopMenuAction,
  type DesktopMenuEntry,
} from "@/shell/commands/desktop-menu"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { useMenubarItems } from "@/runtime/plugin/menubar-items"

// Kobalte closes a submenu when a parent item takes focus. Its pointer triangle covers the straight
// path to the submenu, but not the common path down the parent menu and then across to the last row.
// Keep the submenu through that crossing and close it only after the pointer leaves both menus.
const SUBMENU_CLOSE_DELAY = 300

const accelerators = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).flatMap((entry) => {
  if (entry.type === "separator" || !entry.action || !entry.accelerator?.windows) return []

  // Let the focused editor handle editing shortcuts without restoring stale menu focus.
  if (entry.action.startsWith("edit.")) return []

  return [{ action: entry.action, keybind: parseKeybind(entry.accelerator.windows) }]
})

export function windowsMenuAccelerator(event: KeyboardEvent) {
  return accelerators.find((entry) => matchKeybind(entry.keybind, event))?.action
}

export function WindowsAppMenu(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
}) {
  let lastFocused: HTMLElement | undefined
  const language = useLanguage()
  const menubar = useMenubarItems()
  const [activeSubmenu, setActiveSubmenu] = createSignal<string>()
  const submenuContents = new Map<string, HTMLElement>()
  let menuContent: HTMLElement | undefined
  let pointer = { x: -1, y: -1 }
  let lastInput: "pointer" | "keyboard" = "pointer"
  let closeTimer: number | undefined

  const pointerInside = (element: HTMLElement | undefined) => {
    if (!element?.isConnected) return false

    const rect = element.getBoundingClientRect()

    return pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom
  }

  const pointerInsideMenu = () => {
    if (pointerInside(menuContent)) return true

    const active = activeSubmenu()

    return active !== undefined && pointerInside(submenuContents.get(active))
  }

  const cancelSubmenuClose = () => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    closeTimer = undefined
  }

  const closeSubmenu = () => {
    cancelSubmenuClose()
    setActiveSubmenu(undefined)
  }

  const scheduleSubmenuClose = () => {
    if (closeTimer !== undefined) return
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined

      if (!pointerInsideMenu()) setActiveSubmenu(undefined)
    }, SUBMENU_CLOSE_DELAY)
  }

  const openSubmenu = (id: string) => {
    cancelSubmenuClose()
    setActiveSubmenu(id)
  }

  const requestSubmenuClose = (id: string) => {
    if (activeSubmenu() !== id) return

    if (lastInput === "keyboard") return closeSubmenu()

    if (pointerInsideMenu()) return cancelSubmenuClose()

    scheduleSubmenuClose()
  }

  const entries = (menu: DesktopMenu) =>
    desktopMenuWithPlugins(
      (menu.items ?? [])
        .filter((entry) => desktopMenuVisible(entry, "windows"))
        .map((entry) => ({ key: desktopMenuKey(entry), entry })),
      menubar?.items().filter((item) => item.menu === menu.id) ?? [],
    )

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

  onMount(() => {
    makeEventListener(
      document,
      "keydown",
      (event) => {
        if (event.defaultPrevented) return
        const action = windowsMenuAccelerator(event)

        if (!action) return
        event.preventDefault()
        event.stopPropagation()
        runAction(action)
      },
      { capture: true },
    )

    makeEventListener(
      window,
      "pointermove",
      (event) => {
        pointer = { x: event.clientX, y: event.clientY }
        lastInput = "pointer"

        if (activeSubmenu() === undefined) return

        if (pointerInsideMenu()) return cancelSubmenuClose()

        scheduleSubmenuClose()
      },
      { capture: true },
    )

    makeEventListener(window, "pointerdown", () => (lastInput = "pointer"), { capture: true })
    makeEventListener(window, "keydown", () => (lastInput = "keyboard"), { capture: true })

    // The pointer left the window; no further move can keep the submenu open.
    makeEventListener(
      window,
      "pointerout",
      (event) => {
        if (event.relatedTarget === null && activeSubmenu() !== undefined) scheduleSubmenuClose()
      },
      { capture: true },
    )
  })

  return (
    <Menu
      appearance="standard"
      gutter={4}
      modal={false}
      placement="bottom-start"
      onOpenChange={(open) => {
        if (!open) closeSubmenu()
      }}
    >
      <div
        data-component="desktop-icon-button"
        class="flex h-7 w-9 shrink-0 items-center justify-center rounded-[6px] px-1"
      >
        <Menu.Trigger
          as={IconButton}
          variant="ghost-muted"
          size="large"
          icon={<Icon name="menu" />}
          aria-label={language.t("desktop.menu.ariaLabel")}
          onPointerDown={rememberFocus}
          onKeyDown={rememberFocus}
        />
      </div>
      <Menu.Portal>
        <Menu.Content ref={(element: HTMLElement) => (menuContent = element)} class="desktop-app-menu">
          <Menu.Group>
            <Menu.GroupLabel class="desktop-app-menu-heading">OpenCode</Menu.GroupLabel>
            <For each={DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "windows"))}>
              {(menu) => (
                <DesktopMenuSubmenu
                  label={language.t(menu.labelKey)}
                  open={activeSubmenu() === menu.id}
                  onOpenChange={(open) => (open ? openSubmenu(menu.id) : requestSubmenuClose(menu.id))}
                  onContent={(element) => {
                    if (element) submenuContents.set(menu.id, element)
                    else submenuContents.delete(menu.id)
                  }}
                >
                  <For each={entries(menu)}>
                    {(item) => {
                      const entry = item.entry

                      // Static menu data: an early return keeps the union narrowing a Show fallback would lose.
                      if ("menu" in entry)
                        return (
                          <DesktopMenuItem
                            label={entry.label}
                            disabled={!entry.enabled}
                            onSelect={() => menubar?.run(entry.id)}
                          />
                        )

                      if (entry.type === "separator") return <Menu.Separator />

                      // Plain accessors rather than conditional JSX expressions, which compile to memos created
                      // where the menu reads the prop, possibly outside this owner.
                      const label = () => (entry.labelKey ? language.t(entry.labelKey) : "")

                      const keybind = () =>
                        entry.command ? props.command.keybind(entry.command) : entry.accelerator?.windows

                      const disabled = () => (entry.command ? commandDisabled(entry.command) : false)

                      return (
                        <DesktopMenuItem
                          label={label()}
                          keybind={keybind()}
                          disabled={disabled()}
                          onSelect={() => runEntry(entry)}
                        />
                      )
                    }}
                  </For>
                </DesktopMenuSubmenu>
              )}
            </For>
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

function DesktopMenuSubmenu(props: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onContent: (element: HTMLElement | undefined) => void
  children: JSX.Element
}) {
  return (
    <Menu.Sub open={props.open} onOpenChange={props.onOpenChange}>
      <Menu.SubTrigger>{props.label}</Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          ref={(element: HTMLElement) => props.onContent(element)}
          class="desktop-app-menu desktop-app-menu-sub"
        >
          {props.children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}

function DesktopMenuItem(props: { label: string; keybind?: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <Menu.Item disabled={props.disabled} onSelect={props.onSelect} shortcut={props.keybind}>
      {props.label}
    </Menu.Item>
  )
}

import { Component, createEffect, createMemo, For, Show, onCleanup, onMount, startTransition } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { Menu } from "@opencode-ai/ui/menu"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsGeneral } from "./general/general"
import { SettingsAppearance } from "./appearance/appearance"
import { SettingsKeybinds } from "./keybinds/keybinds"
import { SettingsNotifications } from "./notifications/notifications"
import { SettingsProviders } from "./providers/providers"
import { SettingsModels } from "./models/models"
import { SettingsServers } from "./servers/servers"
import { SettingsWorkspaces } from "./workspaces/workspaces"
import { SettingsProjects } from "./workspaces/projects"
import { SettingsExtensions } from "./providers/extensions"
import { SettingsAbout } from "./about/about"
import { SettingsServerScope } from "./server-scope"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useCommand } from "@/shell/commands/command"
import { useSettingsSurface } from "./surface"
import "@/settings/settings.css"

const sections = [
  [
    { value: "general", icon: "sliders", label: "settings.tab.preferences" },
    { value: "appearance", icon: "appearance", label: "settings.general.section.appearance" },
    { value: "notifications", icon: "notifications", label: "settings.tab.notifications" },
    { value: "shortcuts", icon: "keyboard", label: "settings.tab.shortcuts" },
  ],
  [
    { value: "servers", icon: "server", label: "status.popover.tab.servers" },
    { value: "projects", icon: "folder", label: "settings.tab.projects" },
    { value: "workspaces", icon: "workspace-isolated", label: "settings.tab.workspaces" },
  ],
  [
    { value: "providers", icon: "providers", label: "settings.providers.title" },
    { value: "models", icon: "models", label: "settings.models.title" },
    { value: "extensions", icon: "extensions", label: "settings.tab.extensions" },
  ],
  [{ value: "about", icon: "info", label: "settings.tab.about" }],
] as const

export const SettingsScreen: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const command = useCommand()
  const surface = useSettingsSurface()
  const layout = useLayout()
  const servers = useServers()
  const tabs = useTabs()
  const global = useGlobal()
  let root: HTMLDivElement | undefined

  onMount(() => {
    command.keybinds(false)
    root?.focus({ preventScroll: true })
  })
  onCleanup(() => command.keybinds(true))

  const server = createMemo(() => {
    const route = surface.route()
    switch (route.type) {
      case "draft": {
        const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
        return servers.list.find((item) => ServerConnection.key(item) === draft?.server)
      }
      case "session":
        return servers.list.find((item) => ServerConnection.key(item) === route.server)
      case "home":
        return servers.list.find((item) => ServerConnection.key(item) === layout.home.selection().server)
    }
  })
  const serverCtx = useServerCtx(server)

  createEffect(() => {
    const current = server()
    if (current) global.settings.server.set(ServerConnection.key(current))
  })

  const directory = createMemo(() => {
    const selected = global.settings.server.selected()
    const current = server()
    if (!selected || !current || ServerConnection.key(selected) !== ServerConnection.key(current)) return
    const route = surface.route()
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverCtx()?.data.session.get(route.sessionId)?.location.directory
    return undefined
  })

  const showProviders = () => {
    dialog.close()
    surface.open("providers")
  }

  return (
    <div
      ref={root}
      data-testid="settings-screen"
      class="settings-screen"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || dialog.active) return
        event.preventDefault()
        surface.close()
      }}
    >
      <Tabs
        orientation="vertical"
        variant="settings"
        value={surface.tab()}
        onChange={(value) => void startTransition(() => surface.open(value))}
        class="settings"
      >
        <div class="settings-mobile-nav">
          <button type="button" class="settings-back" onClick={surface.close}>
            <Icon name="arrow-left" size="small" class="settings-back-icon" />
            <span>{language.t("settings.backToApp")}</span>
          </button>
          <Menu placement="bottom-end" gutter={8}>
            <Menu.Trigger as={Button} size="normal" variant="outline" class="settings-mobile-menu-trigger">
              <span>
                {language.t(
                  sections.flat().find((section) => section.value === surface.tab())?.label ??
                    "settings.tab.preferences",
                )}
              </span>
              <Icon name="chevron-down" size="small" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content class="settings-mobile-menu" onEscapeKeyDown={(event) => event.stopPropagation()}>
                <Menu.RadioGroup
                  value={surface.tab()}
                  onChange={(value) => void startTransition(() => surface.open(value))}
                >
                  <For each={sections}>
                    {(group, index) => (
                      <>
                        <Show when={index() > 0}>
                          <Menu.Separator />
                        </Show>
                        <For each={group}>
                          {(section) => (
                            <Menu.RadioItem value={section.value} closeOnSelect>
                              <Icon name={section.icon} />
                              {language.t(section.label)}
                            </Menu.RadioItem>
                          )}
                        </For>
                      </>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
        <Tabs.List>
          <div class="settings-nav">
            <button type="button" class="settings-back" onClick={surface.close}>
              <Icon name="arrow-left" size="small" class="settings-back-icon" />
              <span>{language.t("settings.backToApp")}</span>
            </button>
            <div class="flex flex-col gap-4 w-full">
              <For each={sections}>
                {(group) => (
                  <div class="flex flex-col gap-1 w-full">
                    <For each={group}>
                      {(section) => (
                        <Tabs.Trigger value={section.value}>
                          <Icon name={section.icon} />
                          {language.t(section.label)}
                        </Tabs.Trigger>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Tabs.List>

        <Tabs.Content value="general" class="settings-panel">
          <SettingsGeneral server={server()} />
        </Tabs.Content>
        <Tabs.Content value="appearance" class="settings-panel">
          <SettingsAppearance />
        </Tabs.Content>
        <Tabs.Content value="notifications" class="settings-panel">
          <SettingsNotifications />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="settings-panel">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="servers" class="settings-panel">
          <SettingsServers />
        </Tabs.Content>
        <Tabs.Content value="projects" class="settings-panel">
          <SettingsProjects />
        </Tabs.Content>
        <SettingsServerScope directory={directory()}>
          <Tabs.Content value="workspaces" class="settings-panel">
            <SettingsWorkspaces activeDirectory={directory()} />
          </Tabs.Content>
          <Tabs.Content value="providers" class="settings-panel">
            <SettingsProviders directory={directory()} onBack={showProviders} />
          </Tabs.Content>
          <Tabs.Content value="models" class="settings-panel">
            <SettingsModels />
          </Tabs.Content>
          <Tabs.Content value="extensions" class="settings-panel">
            <SettingsExtensions />
          </Tabs.Content>
        </SettingsServerScope>
        <Tabs.Content value="about" class="settings-panel settings-about">
          <SettingsAbout active={surface.tab() === "about"} />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

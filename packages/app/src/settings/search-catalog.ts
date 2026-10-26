import type { useLanguage } from "@/runtime/i18n/language"
import type { SettingsProjectTab, SettingsRootTab, SettingsServerTab } from "./surface"

type Label = Parameters<ReturnType<typeof useLanguage>["t"]>[0]

// Metadata only: search must not mount settings pages or fetch their catalogs.
type Entry<Tab> = {
  tab: Tab
  label: Label
  target?: string
  keywords?: string
  description?: Label
  section?: Label
  subtab?: "mcps" | "plugins" | "skills" | "lsps"
  available?: "desktop" | "browser" | "mobile"
}

export const clientSettings: Entry<SettingsRootTab>[] = [
  { tab: "general", label: "settings.tab.preferences" },
  { tab: "appearance", label: "settings.general.section.appearance" },
  { tab: "notifications", label: "settings.tab.notifications" },
  { tab: "shortcuts", label: "settings.shortcuts.title", keywords: "keybind keyboard hotkey" },
  { tab: "about", label: "settings.tab.about", keywords: "version license credits" },
  { tab: "experimental", label: "settings.tab.experimental", keywords: "experiments preview beta" },
  { tab: "general", label: "settings.general.row.language.title", target: "settings-language" },
  {
    tab: "general",
    label: "settings.general.row.interfaceMode.title",
    target: "settings-tab-layout",
    keywords: "top side tabs inbox sidebar mode layout vertical horizontal focus pro",
  },
  {
    tab: "general",
    label: "settings.workspaces.default.title",
    target: "settings-workspace-destination",
    description: "settings.workspaces.default.description",
    keywords: "worktree workspace default destination",
  },
  {
    tab: "general",
    label: "command.permissions.autoaccept.enable",
    target: "settings-auto-accept-permissions",
    description: "settings.permissions.autoAccept.default.description",
    keywords: "permissions approve allow auto accept default",
  },
  {
    tab: "general",
    label: "settings.general.row.followUpBehavior.title",
    target: "settings-follow-up-behavior",
    keywords: "queue steer follow up",
  },
  {
    tab: "general",
    label: "settings.general.row.pinchZoom.title",
    target: "settings-pinch-zoom",
    available: "desktop",
  },
  {
    tab: "general",
    label: "settings.general.row.mobileTitlebarBottom.title",
    target: "settings-mobile-titlebar-bottom",
    available: "mobile",
  },
  {
    tab: "general",
    label: "settings.timeline.detail",
    target: "settings-timeline-detail",
    section: "settings.timeline.title",
    keywords: "thinking reasoning tools timeline summary detailed",
  },
  {
    tab: "general",
    label: "settings.timeline.row.backgroundActivity.title",
    description: "settings.timeline.row.backgroundActivity.description",
    target: "settings-background-activity",
    section: "settings.timeline.title",
    keywords: "capsule panel subagent shell background activity position alignment hidden left center right",
  },
  {
    tab: "general",
    label: "settings.timeline.row.width.title",
    description: "settings.timeline.row.width.description",
    target: "settings-timeline-width",
    section: "settings.timeline.title",
    keywords: "column line length measure narrow focused comfortable wide readability",
  },
  {
    tab: "general",
    label: "settings.timeline.row.turnDiffs.title",
    description: "settings.timeline.row.turnDiffs.description",
    target: "settings-show-turn-diffs",
    section: "settings.timeline.title",
  },
  {
    tab: "general",
    label: "settings.general.row.showCustomAgents.title",
    target: "settings-show-custom-agents",
    section: "settings.general.section.general",
  },
  {
    tab: "experimental",
    label: "settings.experimental.row.newIcons.title",
    target: "settings-new-icons",
    description: "settings.experimental.row.newIcons.description",
    keywords: "icons iconography glyphs redesign",
  },
  {
    tab: "experimental",
    label: "settings.experimental.row.newModelPicker.title",
    target: "settings-new-model-picker",
    description: "settings.experimental.row.newModelPicker.description",
    keywords: "model picker selector switcher redesign",
  },
  {
    tab: "appearance",
    label: "settings.general.row.colorScheme.title",
    target: "settings-color-scheme",
    keywords: "dark mode light mode system",
  },
  { tab: "appearance", label: "settings.general.row.theme.title", target: "settings-theme" },
  {
    tab: "appearance",
    label: "settings.general.row.uiFont.title",
    target: "settings-ui-font",
    keywords: "interface typeface",
  },
  {
    tab: "appearance",
    label: "settings.general.row.font.title",
    target: "settings-code-font",
    keywords: "code typeface",
  },
  {
    tab: "appearance",
    label: "settings.general.row.terminalFont.title",
    target: "settings-terminal-font",
    keywords: "terminal typeface",
  },
  {
    tab: "appearance",
    label: "settings.appearance.row.zoom.title",
    target: "settings-zoom",
    keywords: "scale size text font larger bigger accessibility",
    available: "desktop",
  },
  {
    tab: "appearance",
    label: "settings.appearance.row.reduceMotion.title",
    target: "settings-reduce-motion",
    keywords: "animation accessibility",
  },
  {
    tab: "notifications",
    label: "settings.general.notifications.agent.title",
    target: "settings-notifications-agent",
    section: "settings.general.section.notifications",
    description: "settings.general.notifications.agent.description",
    keywords: "desktop notifications agent",
  },
  {
    tab: "notifications",
    label: "settings.general.notifications.permissions.title",
    target: "settings-notifications-permissions",
    section: "settings.general.section.notifications",
    description: "settings.general.notifications.permissions.description",
    keywords: "desktop notifications permissions",
  },
  {
    tab: "notifications",
    label: "settings.general.notifications.errors.title",
    target: "settings-notifications-errors",
    section: "settings.general.section.notifications",
    description: "settings.general.notifications.errors.description",
    keywords: "desktop notifications errors",
  },
  {
    tab: "notifications",
    label: "settings.general.sounds.agent.title",
    target: "settings-sounds-agent",
    section: "settings.general.section.sounds",
    description: "settings.general.sounds.agent.description",
    keywords: "sound audio agent",
  },
  {
    tab: "notifications",
    label: "settings.general.sounds.permissions.title",
    target: "settings-sounds-permissions",
    section: "settings.general.section.sounds",
    description: "settings.general.sounds.permissions.description",
    keywords: "sound audio permissions",
  },
  {
    tab: "notifications",
    label: "settings.general.sounds.errors.title",
    target: "settings-sounds-errors",
    section: "settings.general.section.sounds",
    description: "settings.general.sounds.errors.description",
    keywords: "sound audio errors",
  },
  {
    tab: "notifications",
    label: "settings.general.sounds.interface.title",
    target: "settings-sounds-interface",
    section: "settings.general.section.sounds",
    description: "settings.general.sounds.interface.description",
    keywords: "sound audio interface effects wordmark logo",
  },
]

// Pages showing the selected server, and rows of its card on the Servers page.
export const serverSettings: Entry<SettingsServerTab | "servers">[] = [
  { tab: "projects", label: "settings.tab.projects" },
  { tab: "workspaces", label: "settings.tab.workspaces", keywords: "workspaces disk usage cleanup delete" },
  { tab: "providers", label: "settings.providers.title", keywords: "connect api key credentials" },
  { tab: "models", label: "settings.models.title", keywords: "model picker visibility" },
  { tab: "extensions", label: "settings.tab.extensions" },
  {
    tab: "extensions",
    subtab: "mcps",
    label: "settings.extensions.tab.mcps",
    keywords: "model context protocol tools",
  },
  { tab: "extensions", subtab: "plugins", label: "settings.extensions.tab.plugins" },
  { tab: "extensions", subtab: "skills", label: "settings.extensions.tab.skills" },
  {
    tab: "servers",
    label: "settings.general.row.shell.title",
    target: "settings-shell",
    description: "settings.general.row.shell.description",
    keywords: "bash zsh powershell",
  },
]

export const projectSettings: Entry<SettingsProjectTab>[] = [
  { tab: "general", label: "project.settings.name.title", target: "settings-project-name", keywords: "rename" },
  { tab: "general", label: "dialog.project.edit.icon", target: "settings-project-icon" },
  { tab: "general", label: "dialog.project.edit.color", target: "settings-project-color" },
  {
    tab: "general",
    label: "command.permissions.autoaccept.enable",
    target: "settings-project-auto-accept-permissions",
    keywords: "permissions approve allow auto accept",
  },
  { tab: "workspaces", label: "settings.tab.workspaces", keywords: "workspaces disk usage cleanup delete" },
  { tab: "extensions", label: "settings.tab.extensions" },
  {
    tab: "extensions",
    subtab: "mcps",
    label: "settings.extensions.tab.mcps",
    keywords: "model context protocol tools",
  },
  { tab: "extensions", subtab: "plugins", label: "settings.extensions.tab.plugins" },
  { tab: "extensions", subtab: "skills", label: "settings.extensions.tab.skills" },
  { tab: "extensions", subtab: "lsps", label: "project.settings.extensions.tab.lsps", keywords: "language servers" },
]

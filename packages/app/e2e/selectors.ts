export const promptSelector = '[data-component="prompt-input"]'
export const terminalSelector = '[data-component="terminal"]'
export const sessionComposerDockSelector = '[data-component="session-prompt-dock"]'
export const questionDockSelector = '[data-component="dock-prompt"][data-kind="question"]'
export const permissionDockSelector = '[data-component="dock-prompt"][data-kind="permission"]'
export const permissionRejectSelector = `${permissionDockSelector} [data-slot="permission-footer-actions"] [data-component="button"]:nth-child(1)`
export const permissionAllowAlwaysSelector = `${permissionDockSelector} [data-slot="permission-footer-actions"] [data-component="button"]:nth-child(2)`
export const permissionAllowOnceSelector = `${permissionDockSelector} [data-slot="permission-footer-actions"] [data-component="button"]:nth-child(3)`
export const sessionTodoDockSelector = '[data-component="session-todo-dock"]'
export const sessionTodoToggleSelector = '[data-action="session-todo-toggle"]'
export const sessionTodoToggleButtonSelector = '[data-action="session-todo-toggle-button"]'
export const sessionTodoListSelector = '[data-slot="session-todo-list"]'

export const modelVariantCycleSelector = '[data-action="model-variant-cycle"]'
export const settingsLanguageSelectSelector = '[data-action="settings-language"]'
export const settingsColorSchemeSelector = '[data-action="settings-color-scheme"]'
export const settingsThemeSelector = '[data-action="settings-theme"]'
export const settingsFontSelector = '[data-action="settings-font"]'
export const settingsNotificationsAgentSelector = '[data-action="settings-notifications-agent"]'
export const settingsNotificationsPermissionsSelector = '[data-action="settings-notifications-permissions"]'
export const settingsNotificationsErrorsSelector = '[data-action="settings-notifications-errors"]'
export const settingsSoundsAgentSelector = '[data-action="settings-sounds-agent"]'
export const settingsSoundsPermissionsSelector = '[data-action="settings-sounds-permissions"]'
export const settingsSoundsErrorsSelector = '[data-action="settings-sounds-errors"]'
export const settingsUpdatesStartupSelector = '[data-action="settings-updates-startup"]'
export const settingsReleaseNotesSelector = '[data-action="settings-release-notes"]'

export const sidebarNavSelector = '[data-component="sidebar-nav-desktop"]'

export const projectSwitchSelector = (slug: string) =>
  `${sidebarNavSelector} [data-action="project-switch"][data-project="${slug}"]`

export const projectCloseHoverSelector = (slug: string) => `[data-action="project-close-hover"][data-project="${slug}"]`

export const projectMenuTriggerSelector = (slug: string) =>
  `${sidebarNavSelector} [data-action="project-menu"][data-project="${slug}"]`

export const projectCloseMenuSelector = (slug: string) => `[data-action="project-close-menu"][data-project="${slug}"]`

export const projectClearNotificationsSelector = (slug: string) =>
  `[data-action="project-clear-notifications"][data-project="${slug}"]`

export const projectWorkspacesToggleSelector = (slug: string) =>
  `[data-action="project-workspaces-toggle"][data-project="${slug}"]`

export const titlebarRightSelector = "#opencode-titlebar-right"

export const popoverBodySelector = '[data-slot="popover-body"]'

export const dropdownMenuTriggerSelector = '[data-slot="dropdown-menu-trigger"]'

export const dropdownMenuContentSelector = '[data-component="dropdown-menu-content"]'

export const inlineInputSelector = '[data-component="inline-input"]'

export const sessionItemSelector = (sessionID: string) => `${sidebarNavSelector} [data-session-id="${sessionID}"]`

export const workspaceItemSelector = (slug: string) =>
  `${sidebarNavSelector} [data-component="workspace-item"][data-workspace="${slug}"]`

export const workspaceMenuTriggerSelector = (slug: string) =>
  `${sidebarNavSelector} [data-action="workspace-menu"][data-workspace="${slug}"]`

export const workspaceNewSessionSelector = (slug: string) =>
  `${sidebarNavSelector} [data-action="workspace-new-session"][data-workspace="${slug}"]`

export const listItemSelector = '[data-slot="list-item"]'

export const listItemKeyStartsWithSelector = (prefix: string) => `${listItemSelector}[data-key^="${prefix}"]`

export const listItemKeySelector = (key: string) => `${listItemSelector}[data-key="${key}"]`

export const keybindButtonSelector = (id: string) => `[data-keybind-id="${id}"]`

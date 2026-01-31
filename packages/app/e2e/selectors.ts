export const promptSelector = '[data-component="prompt-input"]'
export const terminalSelector = '[data-component="terminal"]'

export const modelVariantCycleSelector = '[data-action="model-variant-cycle"]'
export const settingsLanguageSelectSelector = '[data-action="settings-language"]'

export const sidebarNavSelector = '[data-component="sidebar-nav-desktop"]'

export const projectSwitchSelector = (slug: string) =>
  `${sidebarNavSelector} [data-action="project-switch"][data-project="${slug}"]`

export const projectCloseHoverSelector = (slug: string) => `[data-action="project-close-hover"][data-project="${slug}"]`

export const projectMenuTriggerSelector = (slug: string) =>
  `${sidebarNavSelector} [data-action="project-menu"][data-project="${slug}"]`

export const projectCloseMenuSelector = (slug: string) => `[data-action="project-close-menu"][data-project="${slug}"]`

export const titlebarRightSelector = "#opencode-titlebar-right"

export const popoverBodySelector = '[data-slot="popover-body"]'

export const dropdownMenuTriggerSelector = '[data-slot="dropdown-menu-trigger"]'

export const dropdownMenuContentSelector = '[data-component="dropdown-menu-content"]'

export const inlineInputSelector = '[data-component="inline-input"]'

export const sessionItemSelector = (sessionID: string) => `${sidebarNavSelector} [data-session-id="${sessionID}"]`

export const listItemSelector = '[data-slot="list-item"]'

export const listItemKeyStartsWithSelector = (prefix: string) => `${listItemSelector}[data-key^="${prefix}"]`

export const listItemKeySelector = (key: string) => `${listItemSelector}[data-key="${key}"]`

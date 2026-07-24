import type { dict as en } from "./i18n/en"

export type DesktopMenuPlatform = "macos" | "windows"

export type DesktopMenuLabelKey = Extract<keyof typeof en, `desktop.appMenu.${string}`>
export type DesktopMenuLabels = Partial<Record<DesktopMenuLabelKey, string>>

export const DESKTOP_MENU_ARIA_LABEL = "desktop.appMenu.ariaLabel" satisfies DesktopMenuLabelKey

export type DesktopMenuAction =
  | "app.checkForUpdates"
  | "app.relaunch"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.reload"
  | "view.toggleDevTools"
  | "view.resetZoom"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleFullscreen"
  | "window.new"
  | "window.close"
  | "window.minimize"
  | "window.toggleMaximize"

export type DesktopMenuRole =
  | "about"
  | "close"
  | "copy"
  | "cut"
  | "hide"
  | "hideOthers"
  | "front"
  | "minimize"
  | "paste"
  | "quit"
  | "redo"
  | "reload"
  | "resetZoom"
  | "selectAll"
  | "toggleDevTools"
  | "togglefullscreen"
  | "undo"
  | "unhide"
  | "window"
  | "windowMenu"
  | "zoom"
  | "zoomIn"
  | "zoomOut"

type DesktopMenuText =
  | { label: string; labelKey: DesktopMenuLabelKey; translatable?: undefined }
  | { label: string; labelKey?: undefined; translatable: false }

export type DesktopMenuItem = (
  | DesktopMenuText
  | { label?: undefined; labelKey?: undefined; translatable?: undefined }
) & {
  type: "item"
  command?: string
  action?: DesktopMenuAction
  role?: DesktopMenuRole
  href?: string
  accelerator?: Partial<Record<DesktopMenuPlatform, string>>
  enabled?: "updater"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuSeparator = {
  type: "separator"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuEntry = DesktopMenuItem | DesktopMenuSeparator

export type DesktopMenu = DesktopMenuText & {
  id: string
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "app",
    label: "OpenCode",
    translatable: false,
    platforms: ["macos"],
    items: [
      { type: "item", label: "About OpenCode", labelKey: "desktop.appMenu.about", role: "about" },
      {
        type: "item",
        label: "Check for Updates...",
        labelKey: "desktop.appMenu.checkForUpdates",
        action: "app.checkForUpdates",
        enabled: "updater",
      },
      {
        type: "item",
        label: "Settings",
        labelKey: "desktop.appMenu.settings",
        command: "settings.open",
        accelerator: { macos: "Cmd+," },
      },
      { type: "item", label: "Reload Webview", labelKey: "desktop.appMenu.reloadWebview", action: "view.reload" },
      { type: "item", label: "Restart", labelKey: "desktop.appMenu.restart", action: "app.relaunch" },
      { type: "item", label: "Export Logs...", labelKey: "desktop.appMenu.exportLogs", command: "logs.export" },
      { type: "separator" },
      { type: "item", label: "Hide OpenCode", labelKey: "desktop.appMenu.hide", role: "hide" },
      { type: "item", label: "Hide Others", labelKey: "desktop.appMenu.hideOthers", role: "hideOthers" },
      { type: "item", label: "Show All", labelKey: "desktop.appMenu.showAll", role: "unhide" },
      { type: "separator" },
      { type: "item", label: "Quit OpenCode", labelKey: "desktop.appMenu.quit", role: "quit" },
    ],
  },
  {
    id: "file",
    label: "File",
    labelKey: "desktop.appMenu.file",
    items: [
      {
        type: "item",
        label: "New Session",
        labelKey: "desktop.appMenu.newSession",
        command: "session.new",
        accelerator: { macos: "Shift+Cmd+S" },
      },
      {
        type: "item",
        label: "Open Project...",
        labelKey: "desktop.appMenu.openProject",
        command: "project.open",
        accelerator: { macos: "Cmd+O" },
      },
      {
        type: "item",
        label: "Settings",
        labelKey: "desktop.appMenu.settings",
        command: "settings.open",
        accelerator: { windows: "Ctrl+," },
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "New Window",
        labelKey: "desktop.appMenu.newWindow",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Close Window",
        labelKey: "desktop.appMenu.closeWindow",
        action: "window.close",
        role: "close",
      },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    labelKey: "desktop.appMenu.edit",
    items: [
      {
        type: "item",
        label: "Undo",
        labelKey: "desktop.appMenu.undo",
        action: "edit.undo",
        role: "undo",
        accelerator: { windows: "Ctrl+Z" },
      },
      {
        type: "item",
        label: "Redo",
        labelKey: "desktop.appMenu.redo",
        action: "edit.redo",
        role: "redo",
        accelerator: { windows: "Ctrl+Y" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Cut",
        labelKey: "desktop.appMenu.cut",
        action: "edit.cut",
        role: "cut",
        accelerator: { windows: "Ctrl+X" },
      },
      {
        type: "item",
        label: "Copy",
        labelKey: "desktop.appMenu.copy",
        action: "edit.copy",
        role: "copy",
        accelerator: { windows: "Ctrl+C" },
      },
      {
        type: "item",
        label: "Paste",
        labelKey: "desktop.appMenu.paste",
        action: "edit.paste",
        role: "paste",
        accelerator: { windows: "Ctrl+V" },
      },
      { type: "item", label: "Delete", labelKey: "desktop.appMenu.delete", action: "edit.delete" },
      {
        type: "item",
        label: "Select All",
        labelKey: "desktop.appMenu.selectAll",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "View",
    labelKey: "desktop.appMenu.view",
    items: [
      { type: "item", label: "Toggle Sidebar", labelKey: "desktop.appMenu.toggleSidebar", command: "sidebar.toggle" },
      {
        type: "item",
        label: "Toggle Terminal",
        labelKey: "desktop.appMenu.toggleTerminal",
        command: "terminal.toggle",
        accelerator: { macos: "Ctrl+`" },
      },
      {
        type: "item",
        label: "Toggle File Tree",
        labelKey: "desktop.appMenu.toggleFileTree",
        command: "fileTree.toggle",
      },
      { type: "separator" },
      { type: "item", label: "Reload", labelKey: "desktop.appMenu.reload", action: "view.reload", role: "reload" },
      {
        type: "item",
        label: "Toggle Developer Tools",
        labelKey: "desktop.appMenu.toggleDeveloperTools",
        action: "view.toggleDevTools",
        role: "toggleDevTools",
      },
      { type: "separator" },
      {
        type: "item",
        label: "Actual Size",
        labelKey: "desktop.appMenu.actualSize",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { windows: "Ctrl+0" },
      },
      {
        type: "item",
        label: "Zoom In",
        labelKey: "desktop.appMenu.zoomIn",
        action: "view.zoomIn",
        role: "zoomIn",
        accelerator: { windows: "Ctrl++" },
      },
      {
        type: "item",
        label: "Zoom Out",
        labelKey: "desktop.appMenu.zoomOut",
        action: "view.zoomOut",
        role: "zoomOut",
        accelerator: { windows: "Ctrl+-" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Toggle Full Screen",
        labelKey: "desktop.appMenu.toggleFullScreen",
        action: "view.toggleFullscreen",
        role: "togglefullscreen",
      },
    ],
  },
  {
    id: "go",
    label: "Go",
    labelKey: "desktop.appMenu.go",
    items: [
      {
        type: "item",
        label: "Back",
        labelKey: "desktop.appMenu.back",
        command: "common.goBack",
        accelerator: { macos: "Cmd+[" },
      },
      {
        type: "item",
        label: "Forward",
        labelKey: "desktop.appMenu.forward",
        command: "common.goForward",
        accelerator: { macos: "Cmd+]" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Previous Session",
        labelKey: "desktop.appMenu.previousSession",
        command: "session.previous",
        accelerator: { macos: "Option+Up" },
      },
      {
        type: "item",
        label: "Next Session",
        labelKey: "desktop.appMenu.nextSession",
        command: "session.next",
        accelerator: { macos: "Option+Down" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Previous Project",
        labelKey: "desktop.appMenu.previousProject",
        command: "project.previous",
        accelerator: { macos: "Cmd+Option+Up" },
      },
      {
        type: "item",
        label: "Next Project",
        labelKey: "desktop.appMenu.nextProject",
        command: "project.next",
        accelerator: { macos: "Cmd+Option+Down" },
      },
    ],
  },
  {
    id: "window",
    label: "Window",
    labelKey: "desktop.appMenu.window",
    items: [
      {
        type: "item",
        label: "Minimize",
        labelKey: "desktop.appMenu.minimize",
        action: "window.minimize",
        role: "minimize",
      },
      {
        type: "item",
        label: "Zoom",
        labelKey: "desktop.appMenu.zoomWindow",
        role: "zoom",
        platforms: ["macos"],
      },
      {
        type: "item",
        label: "Maximize",
        labelKey: "desktop.appMenu.maximize",
        action: "window.toggleMaximize",
        platforms: ["windows"],
      },
      { type: "separator" },
      {
        type: "item",
        label: "Close Window",
        labelKey: "desktop.appMenu.closeWindow",
        action: "window.close",
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "Bring All to Front",
        labelKey: "desktop.appMenu.bringAllToFront",
        role: "front",
        platforms: ["macos"],
      },
      { type: "separator", platforms: ["macos"] },
      { type: "item", role: "window", platforms: ["macos"] },
    ],
  },
  {
    id: "help",
    label: "Help",
    labelKey: "desktop.appMenu.help",
    items: [
      {
        type: "item",
        label: "OpenCode Documentation",
        labelKey: "desktop.appMenu.documentation",
        href: "https://opencode.ai/docs",
      },
      {
        type: "item",
        label: "Support Forum",
        labelKey: "desktop.appMenu.supportForum",
        href: "https://discord.com/invite/opencode",
      },
      { type: "item", label: "Export Logs...", labelKey: "desktop.appMenu.exportLogs", command: "logs.export" },
      { type: "separator" },
      {
        type: "item",
        label: "Share Feedback",
        labelKey: "desktop.appMenu.shareFeedback",
        href: "https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml",
      },
      {
        type: "item",
        label: "Report a Bug",
        labelKey: "desktop.appMenu.reportBug",
        href: "https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml",
      },
    ],
  },
]

export const DESKTOP_MENU_LABEL_KEYS: DesktopMenuLabelKey[] = [
  ...new Set<DesktopMenuLabelKey>([
    DESKTOP_MENU_ARIA_LABEL,
    ...DESKTOP_MENU.flatMap((menu) => [
      ...(menu.labelKey ? [menu.labelKey] : []),
      ...(menu.items?.flatMap((entry) => (entry.type === "item" && entry.labelKey ? [entry.labelKey] : [])) ?? []),
    ]),
  ]),
]

export function translateDesktopMenu(translate: (key: DesktopMenuLabelKey) => string): DesktopMenuLabels {
  return Object.fromEntries(DESKTOP_MENU_LABEL_KEYS.map((key) => [key, translate(key)]))
}

export function desktopMenuLabel(item: { label?: string; labelKey?: DesktopMenuLabelKey }, labels: DesktopMenuLabels) {
  if (!item.labelKey) return item.label
  const translated = labels[item.labelKey]
  return typeof translated === "string" && translated.trim() ? translated : item.label
}

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}

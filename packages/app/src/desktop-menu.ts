export type DesktopMenuPlatform = "macos" | "windows"

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
  | "windowMenu"
  | "zoomIn"
  | "zoomOut"

export type DesktopMenuItem = {
  type: "item"
  label?: string
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

export type DesktopMenu = {
  id: string
  label: string
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "app",
    label: "menu.app",
    platforms: ["macos"],
    items: [
      { type: "item", role: "about" },
      { type: "item", label: "menu.app.checkUpdates", action: "app.checkForUpdates", enabled: "updater" },
      { type: "item", label: "menu.app.settings", command: "settings.open", accelerator: { macos: "Cmd+," } },
      { type: "item", label: "menu.app.reloadWebview", action: "view.reload" },
      { type: "item", label: "menu.app.restart", action: "app.relaunch" },
      { type: "item", label: "menu.app.exportLogs", command: "logs.export" },
      { type: "separator" },
      { type: "item", role: "hide" },
      { type: "item", role: "hideOthers" },
      { type: "item", role: "unhide" },
      { type: "separator" },
      { type: "item", role: "quit" },
    ],
  },
  {
    id: "file",
    label: "menu.file",
    items: [
      {
        type: "item",
        label: "menu.file.newSession",
        command: "session.new",
        accelerator: { macos: "Shift+Cmd+S" },
      },
      { type: "item", label: "menu.file.openProject", command: "project.open", accelerator: { macos: "Cmd+O" } },
      {
        type: "item",
        label: "menu.file.settings",
        command: "settings.open",
        accelerator: { windows: "Ctrl+," },
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "menu.file.newWindow",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      { type: "item", label: "menu.file.closeWindow", action: "window.close", role: "close" },
    ],
  },
  {
    id: "edit",
    label: "menu.edit",
    items: [
      { type: "item", label: "menu.edit.undo", action: "edit.undo", role: "undo", accelerator: { windows: "Ctrl+Z" } },
      { type: "item", label: "menu.edit.redo", action: "edit.redo", role: "redo", accelerator: { windows: "Ctrl+Y" } },
      { type: "separator" },
      { type: "item", label: "menu.edit.cut", action: "edit.cut", role: "cut", accelerator: { windows: "Ctrl+X" } },
      { type: "item", label: "menu.edit.copy", action: "edit.copy", role: "copy", accelerator: { windows: "Ctrl+C" } },
      { type: "item", label: "menu.edit.paste", action: "edit.paste", role: "paste", accelerator: { windows: "Ctrl+V" } },
      { type: "item", label: "menu.edit.delete", action: "edit.delete" },
      {
        type: "item",
        label: "menu.edit.selectAll",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "menu.view",
    items: [
      { type: "item", label: "menu.view.toggleSidebar", command: "sidebar.toggle" },
      { type: "item", label: "menu.view.toggleTerminal", command: "terminal.toggle", accelerator: { macos: "Ctrl+`" } },
      { type: "item", label: "menu.view.toggleFileTree", command: "fileTree.toggle" },
      { type: "separator" },
      { type: "item", label: "menu.view.reload", action: "view.reload", role: "reload" },
      { type: "item", label: "menu.view.toggleDevTools", action: "view.toggleDevTools", role: "toggleDevTools" },
      { type: "separator" },
      {
        type: "item",
        label: "menu.view.actualSize",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { windows: "Ctrl+0" },
      },
      { type: "item", label: "menu.view.zoomIn", action: "view.zoomIn", role: "zoomIn", accelerator: { windows: "Ctrl++" } },
      { type: "item", label: "menu.view.zoomOut", action: "view.zoomOut", role: "zoomOut", accelerator: { windows: "Ctrl+-" } },
      { type: "separator" },
      { type: "item", label: "menu.view.toggleFullScreen", action: "view.toggleFullscreen", role: "togglefullscreen" },
    ],
  },
  {
    id: "go",
    label: "menu.go",
    items: [
      { type: "item", label: "menu.go.back", command: "common.goBack", accelerator: { macos: "Cmd+[" } },
      { type: "item", label: "menu.go.forward", command: "common.goForward", accelerator: { macos: "Cmd+]" } },
      { type: "separator" },
      { type: "item", label: "menu.go.previousSession", command: "session.previous", accelerator: { macos: "Option+Up" } },
      { type: "item", label: "menu.go.nextSession", command: "session.next", accelerator: { macos: "Option+Down" } },
      { type: "separator" },
      {
        type: "item",
        label: "menu.go.previousProject",
        command: "project.previous",
        accelerator: { macos: "Cmd+Option+Up" },
      },
      {
        type: "item",
        label: "menu.go.nextProject",
        command: "project.next",
        accelerator: { macos: "Cmd+Option+Down" },
      },
    ],
  },
  {
    id: "window",
    label: "menu.window",
    role: "windowMenu",
    items: [
      { type: "item", label: "menu.window.minimize", action: "window.minimize" },
      { type: "item", label: "menu.window.maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", label: "menu.window.closeWindow", action: "window.close" },
    ],
  },
  {
    id: "help",
    label: "menu.help",
    items: [
      { type: "item", label: "menu.help.documentation", href: "https://opencode.ai/docs" },
      { type: "item", label: "menu.help.supportForum", href: "https://discord.com/invite/opencode" },
      { type: "item", label: "menu.help.exportLogs", command: "logs.export" },
      { type: "separator" },
      {
        type: "item",
        label: "menu.help.shareFeedback",
        href: "https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml",
      },
      {
        type: "item",
        label: "menu.help.reportBug",
        href: "https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml",
      },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}

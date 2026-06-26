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
  labelKey?: string
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
  labelKey?: string
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "app",
    label: "OpenCode",
    platforms: ["macos"],
    items: [
      { type: "item", role: "about" },
      { type: "item", label: "Check for Updates...", action: "app.checkForUpdates", enabled: "updater" },
      { type: "item", label: "Settings", command: "settings.open", accelerator: { macos: "Cmd+," } },
      { type: "item", label: "Reload Webview", action: "view.reload" },
      { type: "item", label: "Restart", action: "app.relaunch" },
      { type: "item", label: "Export Logs...", command: "logs.export" },
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
    label: "File",
    labelKey: "desktop.menu.file",
    items: [
      {
        type: "item",
        label: "New Session",
        labelKey: "desktop.menu.file.newSession",
        command: "session.new",
        accelerator: { macos: "Shift+Cmd+S" },
      },
      {
        type: "item",
        label: "Open Project...",
        labelKey: "desktop.menu.file.openProject",
        command: "project.open",
        accelerator: { macos: "Cmd+O" },
      },
      {
        type: "item",
        label: "Settings",
        labelKey: "desktop.menu.file.settings",
        command: "settings.open",
        accelerator: { windows: "Ctrl+," },
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "New Window",
        labelKey: "desktop.menu.file.newWindow",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      { type: "item", label: "Close Window", labelKey: "desktop.menu.file.closeWindow", action: "window.close", role: "close" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    labelKey: "desktop.menu.edit",
    items: [
      { type: "item", label: "Undo", labelKey: "desktop.menu.edit.undo", action: "edit.undo", role: "undo", accelerator: { windows: "Ctrl+Z" } },
      { type: "item", label: "Redo", labelKey: "desktop.menu.edit.redo", action: "edit.redo", role: "redo", accelerator: { windows: "Ctrl+Y" } },
      { type: "separator" },
      { type: "item", label: "Cut", labelKey: "desktop.menu.edit.cut", action: "edit.cut", role: "cut", accelerator: { windows: "Ctrl+X" } },
      { type: "item", label: "Copy", labelKey: "desktop.menu.edit.copy", action: "edit.copy", role: "copy", accelerator: { windows: "Ctrl+C" } },
      { type: "item", label: "Paste", labelKey: "desktop.menu.edit.paste", action: "edit.paste", role: "paste", accelerator: { windows: "Ctrl+V" } },
      { type: "item", label: "Delete", labelKey: "desktop.menu.edit.delete", action: "edit.delete" },
      {
        type: "item",
        label: "Select All",
        labelKey: "desktop.menu.edit.selectAll",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "View",
    labelKey: "desktop.menu.view",
    items: [
      { type: "item", label: "Toggle Sidebar", labelKey: "desktop.menu.view.toggleSidebar", command: "sidebar.toggle" },
      { type: "item", label: "Toggle Terminal", labelKey: "desktop.menu.view.toggleTerminal", command: "terminal.toggle", accelerator: { macos: "Ctrl+`" } },
      { type: "item", label: "Toggle File Tree", labelKey: "desktop.menu.view.toggleFileTree", command: "fileTree.toggle" },
      { type: "separator" },
      { type: "item", label: "Reload", labelKey: "desktop.menu.view.reload", action: "view.reload", role: "reload" },
      { type: "item", label: "Toggle Developer Tools", labelKey: "desktop.menu.view.toggleDevTools", action: "view.toggleDevTools", role: "toggleDevTools" },
      { type: "separator" },
      {
        type: "item",
        label: "Actual Size",
        labelKey: "desktop.menu.view.actualSize",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { windows: "Ctrl+0" },
      },
      { type: "item", label: "Zoom In", labelKey: "desktop.menu.view.zoomIn", action: "view.zoomIn", role: "zoomIn", accelerator: { windows: "Ctrl++" } },
      { type: "item", label: "Zoom Out", labelKey: "desktop.menu.view.zoomOut", action: "view.zoomOut", role: "zoomOut", accelerator: { windows: "Ctrl+-" } },
      { type: "separator" },
      { type: "item", label: "Toggle Full Screen", labelKey: "desktop.menu.view.toggleFullscreen", action: "view.toggleFullscreen", role: "togglefullscreen" },
    ],
  },
  {
    id: "go",
    label: "Go",
    labelKey: "desktop.menu.go",
    items: [
      { type: "item", label: "Back", labelKey: "desktop.menu.go.back", command: "common.goBack", accelerator: { macos: "Cmd+[" } },
      { type: "item", label: "Forward", labelKey: "desktop.menu.go.forward", command: "common.goForward", accelerator: { macos: "Cmd+]" } },
      { type: "separator" },
      { type: "item", label: "Previous Session", labelKey: "desktop.menu.go.previousSession", command: "session.previous", accelerator: { macos: "Option+Up" } },
      { type: "item", label: "Next Session", labelKey: "desktop.menu.go.nextSession", command: "session.next", accelerator: { macos: "Option+Down" } },
      { type: "separator" },
      {
        type: "item",
        label: "Previous Project",
        labelKey: "desktop.menu.go.previousProject",
        command: "project.previous",
        accelerator: { macos: "Cmd+Option+Up" },
      },
      {
        type: "item",
        label: "Next Project",
        labelKey: "desktop.menu.go.nextProject",
        command: "project.next",
        accelerator: { macos: "Cmd+Option+Down" },
      },
    ],
  },
  {
    id: "window",
    label: "Window",
    labelKey: "desktop.menu.window",
    role: "windowMenu",
    items: [
      { type: "item", label: "Minimize", labelKey: "desktop.menu.window.minimize", action: "window.minimize" },
      { type: "item", label: "Maximize", labelKey: "desktop.menu.window.maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", label: "Close Window", labelKey: "desktop.menu.window.closeWindow", action: "window.close" },
    ],
  },
  {
    id: "help",
    label: "Help",
    labelKey: "desktop.menu.help",
    items: [
      { type: "item", label: "OpenCode Documentation", labelKey: "desktop.menu.help.documentation", href: "https://opencode.ai/docs" },
      { type: "item", label: "Support Forum", labelKey: "desktop.menu.help.supportForum", href: "https://discord.com/invite/opencode" },
      { type: "item", label: "Export Logs...", labelKey: "desktop.menu.help.exportLogs", command: "logs.export" },
      { type: "separator" },
      {
        type: "item",
        label: "Share Feedback",
        labelKey: "desktop.menu.help.shareFeedback",
        href: "https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml",
      },
      {
        type: "item",
        label: "Report a Bug",
        labelKey: "desktop.menu.help.reportBug",
        href: "https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml",
      },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}

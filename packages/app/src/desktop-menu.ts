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
    items: [
      {
        type: "item",
        label: "New Session",
        command: "session.new",
        accelerator: { macos: "Shift+Cmd+S" },
      },
      { type: "item", label: "Open Project...", command: "project.open", accelerator: { macos: "Cmd+O" } },
      {
        type: "item",
        label: "Settings",
        command: "settings.open",
        accelerator: { windows: "Ctrl+," },
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "New Window",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      { type: "item", label: "Close Window", action: "window.close", role: "close" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      { type: "item", label: "Undo", action: "edit.undo", role: "undo", accelerator: { windows: "Ctrl+Z" } },
      { type: "item", label: "Redo", action: "edit.redo", role: "redo", accelerator: { windows: "Ctrl+Y" } },
      { type: "separator" },
      { type: "item", label: "Cut", action: "edit.cut", role: "cut", accelerator: { windows: "Ctrl+X" } },
      { type: "item", label: "Copy", action: "edit.copy", role: "copy", accelerator: { windows: "Ctrl+C" } },
      { type: "item", label: "Paste", action: "edit.paste", role: "paste", accelerator: { windows: "Ctrl+V" } },
      { type: "item", label: "Delete", action: "edit.delete" },
      {
        type: "item",
        label: "Select All",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      { type: "item", label: "Toggle Sidebar", command: "sidebar.toggle" },
      { type: "item", label: "Toggle Terminal", command: "terminal.toggle", accelerator: { macos: "Ctrl+`" } },
      { type: "item", label: "Toggle File Tree", command: "fileTree.toggle" },
      { type: "separator" },
      { type: "item", label: "Reload", action: "view.reload", role: "reload" },
      { type: "item", label: "Toggle Developer Tools", action: "view.toggleDevTools", role: "toggleDevTools" },
      { type: "separator" },
      {
        type: "item",
        label: "Actual Size",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { windows: "Ctrl+0" },
      },
      { type: "item", label: "Zoom In", action: "view.zoomIn", role: "zoomIn", accelerator: { windows: "Ctrl++" } },
      { type: "item", label: "Zoom Out", action: "view.zoomOut", role: "zoomOut", accelerator: { windows: "Ctrl+-" } },
      { type: "separator" },
      { type: "item", label: "Toggle Full Screen", action: "view.toggleFullscreen", role: "togglefullscreen" },
    ],
  },
  {
    id: "go",
    label: "Go",
    items: [
      { type: "item", label: "Back", command: "common.goBack", accelerator: { macos: "Cmd+[" } },
      { type: "item", label: "Forward", command: "common.goForward", accelerator: { macos: "Cmd+]" } },
      { type: "separator" },
      { type: "item", label: "Previous Session", command: "session.previous", accelerator: { macos: "Option+Up" } },
      { type: "item", label: "Next Session", command: "session.next", accelerator: { macos: "Option+Down" } },
      { type: "separator" },
      {
        type: "item",
        label: "Previous Project",
        command: "project.previous",
        accelerator: { macos: "Cmd+Option+Up" },
      },
      {
        type: "item",
        label: "Next Project",
        command: "project.next",
        accelerator: { macos: "Cmd+Option+Down" },
      },
    ],
  },
  {
    id: "window",
    label: "Window",
    role: "windowMenu",
    items: [
      { type: "item", label: "Minimize", action: "window.minimize" },
      { type: "item", label: "Maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", label: "Close Window", action: "window.close" },
    ],
  },
  {
    id: "help",
    label: "Help",
    items: [
      { type: "item", label: "OpenCode Documentation", href: "https://opencode.ai/docs" },
      { type: "item", label: "Support Forum", href: "https://discord.com/invite/opencode" },
      { type: "item", label: "Export Logs...", command: "logs.export" },
      { type: "separator" },
      {
        type: "item",
        label: "Share Feedback",
        href: "https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml",
      },
      {
        type: "item",
        label: "Report a Bug",
        href: "https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml",
      },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}

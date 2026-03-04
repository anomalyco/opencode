import { BrowserWindow, Menu, shell } from "electron"

import { UPDATER_ENABLED } from "./constants"

type Deps = {
  trigger: (id: string) => void
  installCli: () => void
  checkForUpdates: () => void
  reload: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "OpenCode",
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          enabled: UPDATER_ENABLED,
          click: () => deps.checkForUpdates(),
        },
        {
          label: "Install CLI...",
          click: () => deps.installCli(),
        },
        {
          label: "Reload Webview",
          click: () => deps.reload(),
        },
        {
          label: "Restart",
          click: () => deps.relaunch(),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Session", accelerator: "Shift+Cmd+S", click: () => deps.trigger("session.new") },
        { label: "Open Project...", accelerator: "Cmd+O", click: () => deps.trigger("project.open") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "Cmd+B", click: () => deps.trigger("sidebar.toggle") },
        { label: "Toggle Terminal", accelerator: "Ctrl+`", click: () => deps.trigger("terminal.toggle") },
        { label: "Toggle File Tree", click: () => deps.trigger("fileTree.toggle") },
        { type: "separator" },
        { label: "Back", click: () => deps.trigger("common.goBack") },
        { label: "Forward", click: () => deps.trigger("common.goForward") },
        { type: "separator" },
        {
          label: "Previous Session",
          accelerator: "Option+ArrowUp",
          click: () => deps.trigger("session.previous"),
        },
        {
          label: "Next Session",
          accelerator: "Option+ArrowDown",
          click: () => deps.trigger("session.next"),
        },
        { type: "separator" },
        {
          label: "Toggle Developer Tools",
          accelerator: "Alt+Cmd+I",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "OpenCode Documentation", click: () => shell.openExternal("https://opencode.ai/docs") },
        { label: "Support Forum", click: () => shell.openExternal("https://discord.com/invite/opencode") },
        { type: "separator" },
        { type: "separator" },
        {
          label: "Share Feedback",
          click: () =>
            shell.openExternal("https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml"),
        },
        {
          label: "Report a Bug",
          click: () => shell.openExternal("https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml"),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

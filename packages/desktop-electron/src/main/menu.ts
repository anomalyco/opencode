import { BrowserWindow, Menu, shell } from "electron"

import { UPDATER_ENABLED } from "./constants"
import { createMainWindow } from "./windows"

type Deps = {
  trigger: (id: string) => void
  installCli: () => void
  checkForUpdates: () => void
  reload: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  const isMac = process.platform === "darwin"

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (darwin only)
    ...(isMac
      ? [
          {
            label: "CoBuilder",
            submenu: [
              { role: "about" as const },
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
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Session",
          accelerator: isMac ? "Shift+Cmd+S" : "Shift+Ctrl+S",
          click: () => deps.trigger("session.new"),
        },
        {
          label: "Open Project...",
          accelerator: isMac ? "Cmd+O" : "Ctrl+O",
          click: () => deps.trigger("project.open"),
        },
        {
          label: "New Window",
          accelerator: isMac ? "Cmd+Shift+N" : "Ctrl+Shift+N",
          click: () => createMainWindow({ updaterEnabled: UPDATER_ENABLED }),
        },
        { type: "separator" as const },
        { role: "close" as const },
        // Quit in File menu on Windows/Linux
        ...(!isMac
          ? [
              { type: "separator" as const },
              { role: "quit" as const },
            ]
          : []),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Sidebar",
          accelerator: isMac ? "Cmd+B" : "Ctrl+B",
          click: () => deps.trigger("sidebar.toggle"),
        },
        {
          label: "Toggle Terminal",
          accelerator: "Ctrl+`",
          click: () => deps.trigger("terminal.toggle"),
        },
        { label: "Toggle File Tree", click: () => deps.trigger("fileTree.toggle") },
        { type: "separator" as const },
        { label: "Back", click: () => deps.trigger("common.goBack") },
        { label: "Forward", click: () => deps.trigger("common.goForward") },
        { type: "separator" as const },
        {
          label: "Previous Session",
          accelerator: isMac ? "Option+ArrowUp" : "Alt+ArrowUp",
          click: () => deps.trigger("session.previous"),
        },
        {
          label: "Next Session",
          accelerator: isMac ? "Option+ArrowDown" : "Alt+ArrowDown",
          click: () => deps.trigger("session.next"),
        },
        { type: "separator" as const },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "CoBuilder Documentation", click: () => shell.openExternal("https://opencode.ai/docs") },
        { label: "Support Forum", click: () => shell.openExternal("https://discord.com/invite/opencode") },
        { type: "separator" as const },
        {
          label: "Share Feedback",
          click: () =>
            shell.openExternal("https://github.com/CobuilderLabs/opencode/issues/new?template=feature_request.yml"),
        },
        {
          label: "Report a Bug",
          click: () =>
            shell.openExternal("https://github.com/CobuilderLabs/opencode/issues/new?template=bug_report.yml"),
        },
        // Windows/Linux: show Check for Updates and Install CLI in Help
        ...(!isMac
          ? [
              { type: "separator" as const },
              {
                label: "Check for Updates...",
                enabled: UPDATER_ENABLED,
                click: () => deps.checkForUpdates(),
              },
              {
                label: "Install CLI...",
                click: () => deps.installCli(),
              },
            ]
          : []),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

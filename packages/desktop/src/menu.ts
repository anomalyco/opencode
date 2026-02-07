import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu"
import { type as ostype } from "@tauri-apps/plugin-os"
import { relaunch } from "@tauri-apps/plugin-process"
import { openUrl } from "@tauri-apps/plugin-opener"

import { runUpdater, UPDATER_ENABLED } from "./updater"
import { installCli } from "./cli"
import { initI18n, t } from "./i18n"
import { commands } from "./bindings"

export async function createMenu(trigger: (id: string) => void) {
  if (ostype() !== "macos") return

  await initI18n()

  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: "OpenCode",
        items: [
          await PredefinedMenuItem.new({
            item: { About: null },
          }),
          await MenuItem.new({
            enabled: UPDATER_ENABLED,
            action: () => runUpdater({ alertOnFail: true }),
            text: t("desktop.menu.checkForUpdates"),
          }),
          await MenuItem.new({
            action: () => installCli(),
            text: t("desktop.menu.installCli"),
          }),
          await MenuItem.new({
            action: async () => window.location.reload(),
            text: t("desktop.menu.reloadWebview"),
          }),
          await MenuItem.new({
            action: async () => {
              await commands.killSidecar().catch(() => undefined)
              await relaunch().catch(() => undefined)
            },
            text: t("desktop.menu.restart"),
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await PredefinedMenuItem.new({
            item: "Hide",
          }),
          await PredefinedMenuItem.new({
            item: "HideOthers",
          }),
          await PredefinedMenuItem.new({
            item: "ShowAll",
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await PredefinedMenuItem.new({
            item: "Quit",
          }),
        ].filter(Boolean),
      }),
      await Submenu.new({
        text: "File",
        items: [
          await MenuItem.new({
            text: "New Session",
            accelerator: "Shift+Cmd+S",
            action: () => trigger("session.new"),
          }),
          await MenuItem.new({
            text: "Open Project...",
            accelerator: "Cmd+O",
            action: () => trigger("project.open"),
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await PredefinedMenuItem.new({
            item: "CloseWindow",
          }),
        ],
      }),
      await Submenu.new({
        text: "Edit",
        items: [
          await PredefinedMenuItem.new({
            item: "Undo",
          }),
          await PredefinedMenuItem.new({
            item: "Redo",
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await PredefinedMenuItem.new({
            item: "Cut",
          }),
          await PredefinedMenuItem.new({
            item: "Copy",
          }),
          await PredefinedMenuItem.new({
            item: "Paste",
          }),
          await PredefinedMenuItem.new({
            item: "SelectAll",
          }),
        ],
      }),
      await Submenu.new({
        text: "View",
        items: [
          await MenuItem.new({
            action: () => trigger("sidebar.toggle"),
            text: "Toggle Sidebar",
            accelerator: "Cmd+B",
          }),
          await MenuItem.new({
            action: () => trigger("terminal.toggle"),
            text: "Toggle Terminal",
            accelerator: "Ctrl+`",
          }),
          await MenuItem.new({
            action: () => trigger("fileTree.toggle"),
            text: "Toggle File Tree",
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await MenuItem.new({
            action: () => trigger("common.goBack"),
            text: "Back",
          }),
          await MenuItem.new({
            action: () => trigger("common.goForward"),
            text: "Forward",
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await MenuItem.new({
            action: () => trigger("session.previous"),
            text: "Previous Session",
            accelerator: "Option+ArrowUp",
          }),
          await MenuItem.new({
            action: () => trigger("session.next"),
            text: "Next Session",
            accelerator: "Option+ArrowDown",
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
        ],
      }),
      await Submenu.new({
        text: "Help",
        items: [
          // missing native macos search
          await MenuItem.new({
            action: () => openUrl("https://opencode.ai/docs"),
            text: "OpenCode Documentation",
          }),
          await MenuItem.new({
            action: () => openUrl("https://discord.com/invite/opencode"),
            text: "Support Forum",
          }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          // await MenuItem.new({
          //   text: "Release Notes",
          // }),
          await PredefinedMenuItem.new({
            item: "Separator",
          }),
          await MenuItem.new({
            action: () => openUrl("https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml"),
            text: "Share Feedback",
          }),
          await MenuItem.new({
            action: () => openUrl("https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml"),
            text: "Report a Bug",
          }),
        ],
      }),
    ],
  })
  menu.setAsAppMenu()
}

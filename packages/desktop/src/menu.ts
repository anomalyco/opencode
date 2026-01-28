import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu"
import { type as ostype } from "@tauri-apps/plugin-os"
import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"

import { runUpdater, UPDATER_ENABLED } from "./updater"
import { installCli } from "./cli"
import { initI18n, t } from "./i18n"

export async function createMenu() {
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
              await invoke("kill_sidecar").catch(() => undefined)
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
      // await Submenu.new({
      //   text: "File",
      //   items: [
      //     await MenuItem.new({
      //       enabled: false,
      //       text: "Open Project...",
      //     }),
      //     await PredefinedMenuItem.new({
      //       item: "Separator"
      //     }),
      //     await MenuItem.new({
      //       enabled: false,
      //       text: "New Session",
      //     }),
      //     await PredefinedMenuItem.new({
      //       item: "Separator"
      //     }),
      //     await MenuItem.new({
      //       enabled: false,
      //       text: "Close Project",
      //     })
      //   ]
      // }),
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
    ],
  })
  menu.setAsAppMenu()
}

import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu"
import { type as ostype } from "@tauri-apps/plugin-os"
import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"

import { runUpdater, UPDATER_ENABLED } from "./updater"
import { installCli } from "./cli"

export async function createMenu() {
  const isMacOS = ostype() === "macos"
  
  // Main app menu for all platforms
  const appMenuItems = [
    await PredefinedMenuItem.new({
      item: { About: null },
    }),
  ]
  
  // Add updater and CLI items for all platforms
  if (UPDATER_ENABLED) {
    appMenuItems.push(
      await MenuItem.new({
        action: () => runUpdater({ alertOnFail: true }),
        text: "Check For Updates...",
      })
    )
  }
  
  appMenuItems.push(
    await MenuItem.new({
      action: () => installCli().catch(err => {
        console.error("CLI installation failed:", err)
        // Show user feedback
        if (typeof window !== 'undefined') {
          alert("CLI installation failed. Check console for details.")
        }
      }),
      text: "Install CLI...",
    }),
    await MenuItem.new({
      action: () => window.location.reload(),
      text: "Reload Webview",
    }),
    await MenuItem.new({
      action: async () => {
        try {
          await invoke("kill_sidecar").catch(() => undefined)
          await relaunch().catch(() => undefined)
        } catch (err) {
          console.error("Restart failed:", err)
          if (typeof window !== 'undefined') {
            alert("Restart failed. Check console for details.")
          }
        }
      },
      text: "Restart",
    })
  )
  
  // macOS-specific menu items
  if (isMacOS) {
    appMenuItems.push(
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
      })
    )
  } else {
    // Windows/Linux quit option
    appMenuItems.push(
      await PredefinedMenuItem.new({
        item: "Separator",
      }),
      await MenuItem.new({
        action: () => {
          if (typeof window !== 'undefined') {
            window.close()
          }
        },
        text: "Exit",
      })
    )
  }

  const menu = await Menu.new({
    items: [
      // App menu (File on Windows/Linux, OpenCode on macOS)
      await Submenu.new({
        text: isMacOS ? "OpenCode" : "File",
        items: appMenuItems.filter(Boolean),
      }),
      // Edit menu for all platforms
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
  
  if (isMacOS) {
    menu.setAsAppMenu()
  } else {
    // Set as window menu for Windows/Linux
    menu.setAsWindowMenu()
  }
}

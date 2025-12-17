// @refresh reload
import { render } from "solid-js/web"
import { App, PlatformProvider, Platform } from "@opencode-ai/desktop"
import { onMount } from "solid-js"
import { open, save } from "@tauri-apps/plugin-dialog"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { type as ostype } from "@tauri-apps/plugin-os"
import { AsyncStorage } from "@solid-primitives/storage"

import { runUpdater, UPDATER_ENABLED } from "./updater"
import { createMenu } from "./menu"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

const platform: Platform = {
  platform: "tauri",

  async openDirectoryPickerDialog(opts) {
    const result = await open({
      directory: true,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? "Choose a folder",
    })
    return result
  },

  async openFilePickerDialog(opts) {
    const result = await open({
      directory: false,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? "Choose a file",
    })
    return result
  },

  async saveFilePickerDialog(opts) {
    const result = await save({
      title: opts?.title ?? "Save file",
      defaultPath: opts?.defaultPath,
    })
    return result
  },

  openLink(url: string) {
    shellOpen(url)
  },

  storage: (name = "default.dat") => {
    const api: AsyncStorage = {
      _store: null,
      _getStore: async () => api._store || (api._store = (await import("@tauri-apps/plugin-store")).Store.load(name)),
      getItem: async (key: string) => (await (await api._getStore()).get(key)) ?? null,
      setItem: async (key: string, value: string) => await (await api._getStore()).set(key, value),
      removeItem: async (key: string) => await (await api._getStore()).delete(key),
      clear: async () => await (await api._getStore()).clear(),
      key: async (index: number) => (await (await api._getStore()).keys())[index],
      getLength: async () => (await api._getStore()).length(),
      get length() {
        return api.getLength()
      },
    }
    return api
  },
}

createMenu()

render(() => {
  onMount(() => {
    if (UPDATER_ENABLED) runUpdater({ alertOnFail: false })
  })

  return (
    <PlatformProvider value={platform}>
      {ostype() === "macos" && (
        <div class="bg-background-base border-b border-border-weak-base h-8" data-tauri-drag-region />
      )}
      <App />
    </PlatformProvider>
  )
}, root!)

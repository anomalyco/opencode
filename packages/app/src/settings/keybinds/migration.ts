import { batch, createEffect, untrack } from "solid-js"
import type { useSettings } from "@/settings/model"

/** Stored custom keybinds of commands that built-in GUI extensions now publish under another id. */
export const keybindRenames: Readonly<Record<string, string>> = {
  "app.checkForUpdates": "updater.check",
  "server.pair": "pairing.open",
  "server.ssh.add": "ssh.add",
  "debugBar.toggle": "debug.toggle",
  "session.btw": "btw.ask",
  "session.summary.toggle": "summary.toggle",
}

/** Moves renamed overrides once settings load. An override already stored under the new id wins. */
export function migrateKeybinds(settings: Pick<ReturnType<typeof useSettings>, "ready" | "keybinds">) {
  const state = { done: false }
  createEffect(() => {
    if (state.done || !settings.ready()) return
    state.done = true
    untrack(() =>
      batch(() =>
        Object.entries(keybindRenames).forEach(([from, to]) => {
          const value = settings.keybinds.get(from)
          if (typeof value !== "string") return
          if (settings.keybinds.get(to) === undefined) settings.keybinds.set(to, value)
          settings.keybinds.reset(from)
        }),
      ),
    )
  })
}

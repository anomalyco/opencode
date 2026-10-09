import { batch, createEffect, untrack } from "solid-js"
import { Predicate } from "effect"
import type { useSettings } from "@/settings/model"

/**
 * Stored custom keybinds of commands that built-in GUI extensions now publish under another id. Each old id maps to
 * the current one, and a newer old id comes first, so its override wins over an older one.
 */
export const keybindRenames = {
  "app.checkForUpdates": "updater.check",
  "server.pair": "pairing.open",
  "server.ssh.add": "ssh.add",
  "debugBar.toggle": "debug.toggle",
  "session.btw": "btw.ask",
  // The details extension's earlier id, then the command before extensions.
  "summary.toggle": "details.toggle",
  "session.summary.toggle": "details.toggle",
} satisfies Readonly<Record<string, string>>

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

          if (!Predicate.isString(value)) return

          if (settings.keybinds.get(to) === undefined) settings.keybinds.set(to, value)
          settings.keybinds.reset(from)
        }),
      ),
    )
  })
}

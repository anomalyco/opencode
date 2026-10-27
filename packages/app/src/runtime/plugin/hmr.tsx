import { makeEventListener } from "@solid-primitives/event-listener"
import type { Entry } from "@opencode/plugin/gui/host"
import { BUILTINS_UPDATED } from "./builtins"
import { usePluginHost } from "./host"

/** Development only: reloads the built-in plugins whose renderer code or English copy changed. */
export default function PluginHotReload() {
  const host = usePluginHost()
  makeEventListener(window, BUILTINS_UPDATED, (event) => {
    if (!(event instanceof CustomEvent)) return
    const next: readonly Entry[] = event.detail
    next.forEach((definition) => {
      const current = host.definitions().find((item) => item.id === definition.id)

      if (!current || host.state.status[definition.id] === "disabled") return
      void changed(current, definition).then((value) => {
        if (value) host.reload(definition.id, definition)
      })
    })
  })

  return null
}

// Unchanged modules keep their URL, so importing them again returns the same module.
async function changed(current: Entry, next: Entry) {
  if (current.i18n?.en !== next.i18n?.en) return true

  if (!current.windowEntry || !next.windowEntry) return current.windowEntry !== next.windowEntry
  const [before, after] = await Promise.all([current.windowEntry().catch(() => undefined), next.windowEntry()])

  return before?.default !== after.default
}

import { makeEventListener } from "@solid-primitives/event-listener"
import type { Definition } from "@opencode/gui-extensions/sdk"
import { BUILTINS_UPDATED } from "./builtins"
import { useExtensionHost } from "./host"

/** Development only: reloads the built-in extensions whose renderer code or English copy changed. */
export default function ExtensionHotReload() {
  const host = useExtensionHost()
  makeEventListener(window, BUILTINS_UPDATED, (event) => {
    if (!(event instanceof CustomEvent)) return
    const next: readonly Definition[] = event.detail
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
async function changed(current: Definition, next: Definition) {
  if (current.i18n?.en !== next.i18n?.en) return true
  if (!current.renderer || !next.renderer) return current.renderer !== next.renderer
  const [before, after] = await Promise.all([current.renderer().catch(() => undefined), next.renderer()])
  return before?.default !== after.default
}

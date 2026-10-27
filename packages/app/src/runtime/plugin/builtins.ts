import { builtins } from "@opencode/gui-plugins/renderer"
import type { Entry } from "@opencode/plugin/gui/host"

export { builtins }

/** Dispatched in development with the re-evaluated built-in list after a plugin's files change. */
export const BUILTINS_UPDATED = "opencode:gui-plugins-updated"

// Accepting the list here keeps a plugin edit from reloading the window; hmr.tsx reloads that plugin.
if (import.meta.hot)
  import.meta.hot.accept("@opencode/gui-plugins/renderer", (module) => {
    const next: readonly Entry[] | undefined = module?.builtins

    if (next) window.dispatchEvent(new CustomEvent(BUILTINS_UPDATED, { detail: next }))
  })

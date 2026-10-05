import type { Definition } from "@opencode/gui-extensions/sdk"
import { builtins } from "@opencode/gui-extensions/renderer"

export { builtins }

/** Dispatched in development with the re-evaluated built-in list after an extension's files change. */
export const BUILTINS_UPDATED = "opencode:gui-extensions-updated"

// Accepting the list here keeps an extension edit from reloading the window; hmr.tsx reloads that extension.
if (import.meta.hot)
  import.meta.hot.accept("@opencode/gui-extensions/renderer", (module) => {
    const next: readonly Definition[] | undefined = module?.builtins
    if (next) window.dispatchEvent(new CustomEvent(BUILTINS_UPDATED, { detail: next }))
  })

import { createSignal } from "solid-js"
import type { CopyId } from "./design-mode"

/**
 * What pages read from Design mode (design-mode.tsx). Design mode is a development tool that Site
 * loads only on the development server, so in production it is never on and every copy is the
 * page's own.
 */

export const [designMode, setDesignModeState] = createSignal(false)
export const [editing, setEditing] = createSignal<CopyId>()
// The page's own copy per id, as last rendered, so edits can be compared with it.
export const fallbacks: Partial<Record<CopyId, string>> = {}
// Picks the chosen copy variant; Design mode sets it once it has loaded the saved choices.
export const [chooser, setCopyChooser] = createSignal<(id: CopyId, fallback: string) => string>()

/** The chosen copy variant for `id`, or `fallback` (the page's own copy) by default. */
export function designCopy(id: CopyId, fallback: string) {
  if (!import.meta.env.DEV) return fallback
  fallbacks[id] = fallback
  return chooser()?.(id, fallback) ?? fallback
}

/** True while `id` is being edited in place, so animated copy can render as plain text. */
export function designEditing(id: CopyId) {
  return import.meta.env.DEV && editing() === id
}

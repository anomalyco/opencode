import type { BuiltinMainStorage, MainStoreFrom } from "@opencode/plugin/gui/builtin"
import { History } from "./visits"

/**
 * Where every window of this desktop app keeps the browser's list of the last pages it showed (the `history` store
 * of `index.ts`), and where builds before the plugin rename kept it.
 */
const WINDOW_LISTS: readonly MainStoreFrom[] = [
  { state: ["opencode.global.dat", "plugin.browser.history"] },
  { state: ["opencode.global.dat", "extension.browser.history"] },
]

/**
 * The pages the windows listed before the history store existed, newest first, for the store to take over once. Main
 * storage reads another home only by importing it into a key of its own, which is deleted again: the list stays the
 * windows', who still show it on the new tab page.
 */
export function earlierVisits(storage: BuiltinMainStorage) {
  const visits = storage.store("history.earlier", { schema: History, initial: { visits: [] }, from: WINDOW_LISTS }).value.visits
  storage.remove("history.earlier")

  return visits
}

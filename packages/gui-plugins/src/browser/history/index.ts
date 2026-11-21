// What the profile's side of an import uses of the history. Main process only: the store opens SQLite. The window
// imports the modules it needs by name.
export { MAX_PAGES, MAX_URL_LENGTH, webPage, type PageVisit } from "./page"

export { createHistoryStore } from "./store"

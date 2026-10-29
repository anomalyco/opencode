export * as Teardown from "./teardown.js"

// Work that shutdown may be waiting on: layers releasing their resources and child processes that have not
// closed. Read when a shutdown deadline expires, to name what kept the process alive.
const entries = new Set<{ readonly label: string; readonly since: number }>()

/** Record pending work; call the returned function once it settles. */
export function track(label: string) {
  const entry = { label, since: Date.now() }
  entries.add(entry)
  return () => {
    entries.delete(entry)
  }
}

/** Pending work, oldest first, with how long each has been pending. */
export function pending(now = Date.now()) {
  return Array.from(entries, (entry) => ({ label: entry.label, ms: now - entry.since }))
}

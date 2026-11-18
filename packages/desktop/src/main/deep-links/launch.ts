import { app } from "electron"
import type { Event } from "electron"

// macOS hands the link that started the app to `open-url` before `ready`, and Electron keeps nothing for a listener
// that registers later. The layers that route links load after the first window, so the entry module holds what
// arrives until they take over.
const held: string[] = []

const hold = (event: Event, url: string) => {
  event.preventDefault()
  held.push(url)
}

export function holdEarlyLinks() {
  app.on("open-url", hold)
}

/** Stops holding and returns what arrived. The caller registers its own listener in the same tick. */
export function takeEarlyLinks() {
  app.off("open-url", hold)

  return held.splice(0)
}

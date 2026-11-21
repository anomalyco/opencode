import { app } from "electron"
import type { Event } from "electron"

// The `opencode://` links the app was started with, held until the deep-link router takes them. Windows and Linux
// pass a link on the command line; macOS sends `open-url` while the app finishes launching, before the router's own
// listener exists.
const pending: string[] = []

const early = (event: Event, url: string) => {
  event.preventDefault()
  pending.push(url)
}

export function captureLaunchLinks() {
  pending.push(...deepLinkArguments(process.argv))
  app.on("open-url", early)
}

/** The links the app was started with; later ones reach the router's own listener. */
export function takeLaunchLinks() {
  app.off("open-url", early)

  return pending.splice(0)
}

export function deepLinkArguments(argv: readonly string[]) {
  return argv.filter((arg) => arg.startsWith("opencode://"))
}

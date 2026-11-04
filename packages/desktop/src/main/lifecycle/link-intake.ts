import { app } from "electron"

const MAX_LINKS = 16

let receiver: ((urls: string[]) => void) | undefined

const buffered: string[] = []

// Runs from the entry module, before ready: on macOS the link that launches the app arrives as
// open-url while the main bundle is still loading, and on Windows and Linux it is in the first
// launch's argv. Links wait here until the lifecycle has restored its windows and can route them.
// Keep this module free of Effect and the rest of main; it is evaluated before the first window.
export function startLinkIntake() {
  app.on("open-url", (event, url) => {
    event.preventDefault()
    accept([url])
  })
  app.on("second-instance", (_event, argv) => accept(linkArguments(argv)))

  if (process.platform !== "darwin") accept(linkArguments(process.argv.slice(1)))
}

/** Delivers buffered and future links to `receive` until the returned function is called. */
export function receiveLinks(receive: (urls: string[]) => void) {
  receiver = receive
  const urls = buffered.splice(0)

  if (urls.length) receive(urls)

  return () => {
    if (receiver === receive) receiver = undefined
  }
}

export function linkArguments(argv: readonly string[]) {
  return argv.filter((arg) => arg.startsWith("opencode://")).slice(0, MAX_LINKS)
}

function accept(urls: string[]) {
  if (!urls.length) return

  if (receiver) return receiver(urls)
  buffered.push(...urls)
  buffered.splice(0, Math.max(0, buffered.length - MAX_LINKS))
}

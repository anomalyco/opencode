import { app, type Event } from "electron"

export const isDeepLink = (value: string) => value.startsWith("opencode://")

// Windows and Linux pass the launch link on the command line. macOS sends `open-url`, usually before the main bundle
// loads, so the entry module listens from the start. A later link replaces an earlier one.
let launch: string | undefined

const openUrl = (event: Event, url: string) => {
  event.preventDefault()
  launch = url
}

export function captureLaunchDeepLink() {
  launch = process.argv.find(isDeepLink)
  app.on("open-url", openUrl)
}

/** Stops listening for the launch link and returns it. */
export function takeLaunchDeepLink() {
  app.off("open-url", openUrl)
  const url = launch
  launch = undefined

  return url
}

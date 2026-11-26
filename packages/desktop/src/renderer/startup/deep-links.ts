import type { ElectronAPI } from "../api-types"

// Main holds links until a window takes them, so a window takes them when the app starts listening and again each
// time main says more arrived. Only the first window to ask receives a link, and it never comes back on a reload.
export function createDeepLinks(api: Pick<ElectronAPI, "takeDeepLinks" | "onDeepLink">) {
  return (listener: (urls: string[]) => void) => {
    const take = () =>
      void api.takeDeepLinks().then(
        (urls) => {
          if (urls.length) listener(urls)
        },
        (error) => console.error("[deep-links] failed to take links", error),
      )

    const stop = api.onDeepLink(take)
    take()

    return stop
  }
}

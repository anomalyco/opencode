import type { ElectronAPI } from "../api-types"

let receiver: ((url: string) => void) | undefined

const buffered: string[] = []

// Starts before the app mounts so a link that launched the window waits until the app subscribes.
export function startDeepLinks(api: ElectronAPI) {
  api.onDeepLink(deliver)
  void api.consumeInitialDeepLinks().then(deliver)
}

export function onOpenLink(receive: (url: string) => void) {
  receiver = receive
  buffered.splice(0).forEach(receive)

  return () => {
    if (receiver === receive) receiver = undefined
  }
}

function deliver(urls: string[]) {
  urls.forEach((url) => (receiver ? receiver(url) : buffered.push(url)))
}

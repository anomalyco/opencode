import { bootstrap } from "./bootstrap"

// The browser only starts a worker from a same-origin script, and the webview's scripts come from VS Code's resource
// origin. VS Code also serves those resources only to the webview document: its service worker cannot match a worker's
// requests to the webview, so they hang. A `data:` worker has an opaque origin the service worker does not control, and
// it imports the script from the extension host's loopback copy of the same files, as do the script's own imports.
// Swapped in before the app loads, so its markdown and diff workers start.
const NativeWorker = window.Worker

window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(workerUrl(new URL(url, location.href).href, options), options)
  }
}

function workerUrl(url: string, options?: WorkerOptions) {
  if (!url.startsWith(document.baseURI)) return url
  const script = JSON.stringify(`${bootstrap.assets}/${url.slice(document.baseURI.length)}`)

  if (options?.type !== "module") return `data:text/javascript,${encodeURIComponent(`importScripts(${script})`)}`

  // A static import from a `data:` module worker fails to load in VS Code's webview, while `import()` succeeds. The
  // worker starts delivering messages once this wrapper has run, before the script attaches its handlers, so hold them
  // until it has, and rethrow a failed import as the worker's error.
  const source = `
const held = []
const hold = (event) => {
  event.stopImmediatePropagation()
  held.push(event)
}
addEventListener("message", hold)
import(${script}).then(
  () => {
    removeEventListener("message", hold)
    held.forEach((event) => dispatchEvent(new MessageEvent("message", { data: event.data, ports: [...event.ports] })))
  },
  (error) => setTimeout(() => {
    throw error
  }),
)`

  return `data:text/javascript,${encodeURIComponent(source)}`
}

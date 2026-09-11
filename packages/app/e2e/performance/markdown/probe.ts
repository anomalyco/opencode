import type { Page } from "@playwright/test"
import type {
  MarkdownWorkerRequest,
  MarkdownWorkerResponse,
} from "../../../../session-ui/src/components/markdown-worker-protocol"

export async function installMarkdownGate(
  page: Page,
  input: { answer: string; sourcePart: string; targetPart: string; href: string },
) {
  await page.addInitScript(({ answer, sourcePart, targetPart, href }) => {
    const stats = {
      admitted: 0,
      responses: 0,
      held: false,
      started: 0,
      ready: 0,
      released: 0,
      settled: 0,
      sanitizeCalls: 0,
      sanitizeChars: 0,
      arm: () => {
        armed = true
      },
    }
    let armed = false
    let id: number | undefined
    let release: (() => void) | undefined
    const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, "onmessage")!
    const post = Worker.prototype.postMessage
    Object.defineProperty(Worker.prototype, "onmessage", {
      configurable: true,
      get: descriptor.get,
      set(callback: (event: MessageEvent<MarkdownWorkerResponse>) => void) {
        descriptor.set!.call(this, (event: MessageEvent<MarkdownWorkerResponse>) => {
          if (event.data.type === "parse" && event.data.id === id) {
            stats.responses++
            stats.held = true
            release = () => callback.call(this, event)
            return
          }
          callback.call(this, event)
        })
      },
    })
    Worker.prototype.postMessage = function (request: MarkdownWorkerRequest) {
      if (request.type === "parse" && request.text === answer) {
        id = request.id
        stats.admitted++
      }
      post.call(this, request)
    }
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (text, type) {
      if (stats.released && String(text).includes("Recovery implementation review")) {
        stats.sanitizeCalls++
        stats.sanitizeChars += String(text).length
      }
      return parse.call(this, text, type)
    }
    document.addEventListener(
      "mousedown",
      (event) => {
        if (!armed || stats.started) return
        const target = event.target instanceof Element ? event.target.closest("a") : undefined
        if (target?.getAttribute("href") !== href) return
        stats.started = performance.now()
      },
      true,
    )
    // The app can retain the outgoing view until the destination is ready. Release
    // only after its actual row detaches, rather than assuming click means dispose.
    new MutationObserver(() => {
      if (!stats.started || stats.released) return
      const current = document.querySelector(`[data-timeline-part-id="${sourcePart}"] [data-markdown-ready]`)
      if (!current) return
      stats.ready ||= performance.now()
      if (document.querySelector(`[data-timeline-part-id="${targetPart}"]`)) return
      stats.released = performance.now()
      performance.mark("markdown-timeline-disposed")
      release!()
      release = undefined
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        stats.settled = performance.now()
        channel.port1.close()
        channel.port2.close()
      }
      channel.port2.postMessage(null)
    }).observe(document, { childList: true, subtree: true, attributes: true })
    Object.defineProperty(window, "markdownGate", { value: stats })
  }, input)
}

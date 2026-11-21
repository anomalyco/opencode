import { Option, Schema } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileContent, Files } from "@opencode/plugin/gui"
import { bytesFromContent, frameMediaPath, htmlWithScript } from "./artifact"
import { fileTabId } from "./path"

/** Marks messages between the app and the media script it adds to an HTML preview. */
const CHANNEL = "opencode-file-media"

/** The HTML with the media script added. */
export function mediaHtml(content: FileContent) {
  return htmlWithScript(content, `(${frameMedia.toString()})(${JSON.stringify(CHANNEL)})`)
}

/**
 * Loads the images, audio and video an HTML preview references by relative path. The preview is a blob in a sandboxed
 * frame, so those references resolve to nothing and the frame cannot reach the server itself: its script asks for each
 * file here and gets the bytes back.
 */
export function createFrameMedia(input: {
  frame: () => HTMLIFrameElement | undefined
  path: () => string
  file: Files
  /** The open file tabs' ids. */
  open: () => readonly string[]
}) {
  makeEventListener(window, "message", async (event: MessageEvent) => {
    const target = input.frame()?.contentWindow

    if (!target || event.source !== target) return
    const request = decodeRequest(event.data)

    if (Option.isNone(request)) return
    const path = frameMediaPath(input.path(), request.value.path)

    if (!path) return

    if (!input.file.get(path)?.content) {
      await input.file.sync(path, { silent: true })

      // `sync` starts a server watch that only an open tab of the file needs.
      if (!input.open().includes(fileTabId(input.file, path))) input.file.unwatch(path)
    }

    const content = input.file.get(path)?.content

    if (!content) return

    const bytes = content.url
      ? await fetch(content.url).then((response) => response.arrayBuffer())
      : bytesFromContent(content).buffer

    // The reply names the path as the page wrote it, which is how its script finds the elements to fill.
    target.postMessage({ source: CHANNEL, path: request.value.path, mime: content.mimeType, bytes }, "*", [bytes])
  })
}

/** What the HTML preview's script sends; the page's own scripts can post to this window too. */
const decodeRequest = Schema.decodeUnknownOption(
  Schema.Struct({ source: Schema.Literal(CHANNEL), path: Schema.String }),
)

/**
 * Runs inside the HTML preview, serialized into its page, so it can use nothing from this module. It asks the app for
 * each relative image, audio and video source as it comes into view, and swaps in a blob URL made from the reply.
 */
function frameMedia(channel: string) {
  const media = "img, video, audio, source"
  const asked = new Set<string>()
  const urls = new Map<string, string>()

  const show = (element: Element, url: string) => {
    element.setAttribute("src", url)

    // A media element only looks at its sources again when told to.
    if (element instanceof HTMLSourceElement && element.parentElement instanceof HTMLMediaElement) {
      element.parentElement.load()
    }
  }

  const load = (element: Element) => {
    const path = element.getAttribute("src")

    // Anything with a scheme or a leading slash is not a file beside the page.
    if (!path || /^([a-z][a-z0-9+.-]*:|\/)/i.test(path)) return
    const url = urls.get(path)

    if (url) return show(element, url)

    if (asked.has(path)) return
    asked.add(path)
    parent.postMessage({ source: channel, path }, "*")
  }

  const visible = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      visible.unobserve(entry.target)
      load(entry.target)

      for (const source of entry.target.querySelectorAll("source")) load(source)
    }
  })

  window.addEventListener("message", (event) => {
    const data = event.data

    // The preview can reload while files are on their way, so a reply to the page before this one is ignored.
    if (event.source !== parent || data?.source !== channel || urls.has(data.path)) return
    const url = URL.createObjectURL(new Blob([data.bytes], { type: data.mime }))
    urls.set(data.path, url)

    for (const element of document.querySelectorAll(media)) {
      if (element.getAttribute("src") === data.path) show(element, url)
    }
  })

  // The script runs before the page is parsed, so every element arrives here, as do ones the page adds later.
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue

        for (const element of [node, ...node.querySelectorAll(media)]) {
          // A source has no box of its own to come into view.
          const box = element instanceof HTMLSourceElement ? element.parentElement : element

          if (box?.matches(media)) visible.observe(box)
        }
      }
    }
  }).observe(document, { subtree: true, childList: true })
}

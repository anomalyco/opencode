import electron, { type BrowserWindow, type NativeImage, type WebContents, type WebContentsView } from "electron"
import { decodePresenterEvents, toInputEvents } from "./presenter-input"

export type Presenters = ReturnType<typeof createPresenters>

export type Presenter = {
  /** The view the host embed system lays out where the page would be. */
  readonly view: WebContentsView
  /** Re-applies the size policy, after the agent pinned or cleared a viewport. */
  resize(): void
  dispose(): void
}

type Waiter = () => void

type Entry = {
  readonly page: WebContents
  readonly window: BrowserWindow
  readonly pinned: () => { readonly width: number; readonly height: number } | undefined
  frame: number
  image?: NativeImage
  frames: Set<Waiter>
  cursor: { id: number; value: string }
  cursors: Set<Waiter>
  /** The presenter's last reported CSS size, which an unpinned page follows. */
  size?: { width: number; height: number }
  focused: boolean
}

// Electron's cursor names, as CSS cursors.
const cursors = new Map(
  Object.entries({
    default: "default",
    pointer: "default",
    hand: "pointer",
    ibeam: "text",
    "vertical-text": "vertical-text",
    crosshair: "crosshair",
    wait: "wait",
    progress: "progress",
    help: "help",
    move: "move",
    "col-resize": "col-resize",
    "row-resize": "row-resize",
    "e-resize": "e-resize",
    "n-resize": "n-resize",
    "ne-resize": "ne-resize",
    "nw-resize": "nw-resize",
    "s-resize": "s-resize",
    "se-resize": "se-resize",
    "sw-resize": "sw-resize",
    "w-resize": "w-resize",
    "ns-resize": "ns-resize",
    "ew-resize": "ew-resize",
    "nesw-resize": "nesw-resize",
    "nwse-resize": "nwse-resize",
    "not-allowed": "not-allowed",
    "no-drop": "no-drop",
    grab: "grab",
    grabbing: "grabbing",
    "zoom-in": "zoom-in",
    "zoom-out": "zoom-out",
    copy: "copy",
    alias: "alias",
    "context-menu": "context-menu",
    cell: "cell",
    none: "none",
  }),
)

const headers = { "cache-control": "no-store" }

/**
 * Shows the agent's offscreen pages in the pane. Each presenter is a small trusted page in its own partition that
 * pulls the latest frame of its offscreen page and posts the user's input back, both through a protocol handler only
 * that partition reaches. One per browser pane instance.
 */
export function createPresenters() {
  const partition = `opencode-browser-presenter-${crypto.randomUUID()}`
  const session = electron.session.fromPartition(partition)
  const entries = new Map<string, Entry>()

  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.protocol.handle("https", async (request) => {
    const url = new URL(request.url)
    const entry = entries.get(url.hostname)

    if (!entry || entry.page.isDestroyed()) return new Response("Not found", { status: 404, headers })

    if (url.pathname === "/") return new Response(page, { headers: { ...headers, "content-type": "text/html" } })

    if (url.pathname === "/frame") return frame(entry, Number(url.searchParams.get("after") ?? 0))

    if (url.pathname === "/events") return cursor(entry, Number(url.searchParams.get("after") ?? 0))

    if (url.pathname === "/input" && request.method === "POST") {
      input(entry, await request.text())

      return new Response(null, { status: 204, headers })
    }

    return new Response("Not found", { status: 404, headers })
  })

  return {
    create(input: {
      /** The offscreen page's contents and the hidden window that owns them. */
      readonly page: WebContents
      readonly window: BrowserWindow
      /** The agent pinned a viewport: the page keeps it and the presenter letterboxes it. */
      readonly pinned: () => { readonly width: number; readonly height: number } | undefined
    }): Presenter {
      const host = `${crypto.randomUUID()}.presenter.invalid`

      const entry: Entry = {
        page: input.page,
        window: input.window,
        pinned: input.pinned,
        frame: 0,
        frames: new Set(),
        cursor: { id: 0, value: "default" },
        cursors: new Set(),
        focused: false,
      }

      // Only the newest frame is kept; a presenter that falls behind skips to it.
      const paint = (_event: Electron.Event, _dirty: Electron.Rectangle, image: NativeImage) => {
        entry.image = image
        entry.frame++
        wake(entry.frames)
      }

      const changed = (_event: Electron.Event, type: string) => {
        entry.cursor = { id: entry.cursor.id + 1, value: cursors.get(type) ?? "default" }
        wake(entry.cursors)
      }

      input.page.on("paint", paint)
      input.page.on("cursor-changed", changed)
      entries.set(host, entry)

      const view = new electron.WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
          spellcheck: false,
        },
      })

      view.setBackgroundColor("#00000000")
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      view.webContents.on("will-navigate", (event) => event.preventDefault())
      void view.webContents.loadURL(`https://${host}/`).catch(() => undefined)

      return {
        view,
        resize: () => size(entry),
        dispose() {
          entries.delete(host)
          wake(entry.frames)
          wake(entry.cursors)

          if (!input.page.isDestroyed()) {
            input.page.off("paint", paint)
            input.page.off("cursor-changed", changed)
          }

          if (!view.webContents.isDestroyed()) view.webContents.close()
        },
      }
    },
    dispose() {
      entries.forEach((entry) => {
        wake(entry.frames)
        wake(entry.cursors)
      })
      entries.clear()
      session.protocol.unhandle("https")
    },
  }
}

function wake(waiters: Set<Waiter>) {
  const list = Array.from(waiters)
  waiters.clear()
  list.forEach((waiter) => waiter())
}

/** Resolves once a newer value arrives, or after a second so the presenter polls again. */
function newer(waiters: Set<Waiter>, current: () => number, after: number) {
  if (current() > after) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, 1_000)

    function done() {
      clearTimeout(timer)
      waiters.delete(done)
      resolve()
    }

    waiters.add(done)
  })
}

async function frame(entry: Entry, after: number) {
  await newer(entry.frames, () => entry.frame, after)

  // A page that has not painted since the presenter appeared still has a picture to show.
  if (!entry.image && !entry.page.isDestroyed()) {
    entry.image = await entry.page.capturePage().catch(() => undefined)
    entry.frame++
  }

  if (entry.frame <= after || !entry.image || entry.image.isEmpty())
    return new Response(null, { status: 204, headers })
  const [width, height] = entry.window.isDestroyed() ? [0, 0] : entry.window.getContentSize()

  return new Response(new Uint8Array(entry.image.toJPEG(90)), {
    headers: {
      ...headers,
      "content-type": "image/jpeg",
      "x-frame": String(entry.frame),
      "x-width": String(width ?? 0),
      "x-height": String(height ?? 0),
    },
  })
}

async function cursor(entry: Entry, after: number) {
  await newer(entry.cursors, () => entry.cursor.id, after)

  return Response.json({ id: entry.cursor.id, cursor: entry.cursor.value }, { headers })
}

function input(entry: Entry, body: string) {
  decodePresenterEvents(body).forEach((event) => {
    if (entry.page.isDestroyed()) return

    if (event.kind === "resize") {
      entry.size = { width: Math.round(event.width), height: Math.round(event.height) }
      size(entry)

      return
    }

    // Offscreen contents take keyboard and pointer input only while they have focus.
    if (event.kind === "focus" || !entry.focused) {
      entry.page.focus()
      entry.focused = true
    }

    if (event.kind === "text") {
      entry.page.insertText(event.text).catch(() => undefined)

      return
    }

    toInputEvents(event).forEach((item) => entry.page.sendInputEvent(item))
  })
}

/** An unpinned page takes the presenter's size; a pinned one keeps the agent's. */
function size(entry: Entry) {
  if (entry.window.isDestroyed() || entry.pinned() || !entry.size) return
  const width = Math.min(4_000, Math.max(200, entry.size.width))
  const height = Math.min(4_000, Math.max(200, entry.size.height))
  const [current, currentHeight] = entry.window.getContentSize()

  if (current !== width || currentHeight !== height) entry.window.setContentSize(width, height)
}

// The presenter page: draws the newest frame letterboxed into the view and posts the user's input, in order.
const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  canvas { display: block; width: 100vw; height: 100vh; outline: none; touch-action: none; }
</style>
</head>
<body>
<canvas id="screen" tabindex="0"></canvas>
<script>
"use strict"
const canvas = document.getElementById("screen")
const context = canvas.getContext("2d")
// The page's CSS size, and where its frame sits in the canvas.
const view = { width: 0, height: 0, scale: 1, left: 0, top: 0 }
let bitmap = null
let after = 0
let cursorAfter = 0
let running = false
let watching = false

const layout = () => {
  const ratio = devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  view.scale = view.width && view.height ? Math.min(width / view.width, height / view.height, 1) : 1
  view.left = (width - view.width * view.scale) / 2
  view.top = (height - view.height * view.scale) / 2
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  if (bitmap) context.drawImage(bitmap, view.left, view.top, view.width * view.scale, view.height * view.scale)
}

const frames = async () => {
  if (running) return
  running = true
  while (document.visibilityState === "visible") {
    try {
      const response = await fetch("/frame?after=" + after, { cache: "no-store" })
      if (response.status !== 200) continue
      after = Number(response.headers.get("x-frame")) || after
      view.width = Number(response.headers.get("x-width")) || view.width
      view.height = Number(response.headers.get("x-height")) || view.height
      const next = await createImageBitmap(await response.blob())
      if (bitmap) bitmap.close()
      bitmap = next
      layout()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  running = false
}

const cursors = async () => {
  if (watching) return
  watching = true
  while (document.visibilityState === "visible") {
    try {
      const response = await fetch("/events?after=" + cursorAfter, { cache: "no-store" })
      const value = await response.json()
      cursorAfter = value.id
      canvas.style.cursor = value.cursor
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  watching = false
}

// One request at a time keeps the input in order; moves between two posts collapse into the newest.
const queue = []
let sending = false
const send = (event) => {
  const last = queue[queue.length - 1]
  if (event.kind === "mouse" && event.type === "move" && last && last.kind === "mouse" && last.type === "move") queue[queue.length - 1] = event
  else if (event.kind === "resize" && last && last.kind === "resize") queue[queue.length - 1] = event
  else queue.push(event)
  void flush()
}
const flush = async () => {
  if (sending || !queue.length) return
  sending = true
  const batch = queue.splice(0)
  try {
    await fetch("/input", { method: "POST", body: JSON.stringify(batch) })
  } catch {}
  sending = false
  void flush()
}

const modifiers = (event) => ({ shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey })
const position = (event) => {
  const rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left - view.left) / view.scale
  const y = (event.clientY - rect.top - view.top) / view.scale
  return { x: Math.max(0, Math.min(view.width, x)), y: Math.max(0, Math.min(view.height, y)) }
}
const pointer = (type) => (event) => {
  if (type === "down") {
    canvas.focus()
    if (event.button === 2) event.preventDefault()
  }
  send({ kind: "mouse", type, ...position(event), button: event.button === 1 || event.button === 2 ? event.button : 0, buttons: event.buttons, clicks: event.detail || 1, modifiers: modifiers(event) })
}

canvas.addEventListener("mousedown", pointer("down"))
canvas.addEventListener("mouseup", pointer("up"))
canvas.addEventListener("mousemove", pointer("move"))
canvas.addEventListener("mouseleave", pointer("leave"))
canvas.addEventListener("contextmenu", (event) => event.preventDefault())
canvas.addEventListener("wheel", (event) => {
  event.preventDefault()
  send({ kind: "wheel", ...position(event), deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, modifiers: modifiers(event) })
}, { passive: false })
canvas.addEventListener("focus", () => send({ kind: "focus" }))
const key = (type) => (event) => {
  // Keys an input method is composing reach the page as text when the composition ends.
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  send({ kind: "key", type, key: event.key, code: event.code, repeat: event.repeat, modifiers: modifiers(event) })
}
canvas.addEventListener("keydown", key("down"))
canvas.addEventListener("keyup", key("up"))
canvas.addEventListener("compositionend", (event) => { if (event.data) send({ kind: "text", text: event.data }) })
canvas.addEventListener("paste", (event) => event.preventDefault())

let resizing = 0
new ResizeObserver(() => {
  layout()
  clearTimeout(resizing)
  resizing = setTimeout(() => {
    if (canvas.clientWidth && canvas.clientHeight) send({ kind: "resize", width: canvas.clientWidth, height: canvas.clientHeight })
  }, 50)
}).observe(canvas)

document.addEventListener("visibilitychange", () => {
  void frames()
  void cursors()
})
void frames()
void cursors()
</script>
</body>
</html>`

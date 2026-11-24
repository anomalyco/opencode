import { Option, Schema } from "effect"
import { createSignal, onCleanup, Show, untrack } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createKeyed, type FileContent } from "@opencode/plugin/gui"
import { FileSearchBar } from "@opencode/session-ui/file-search"

const HIT = "file-preview-find"

const ACTIVE = "file-preview-find-current"

/** Marks messages between the bar and the script it adds to an HTML preview. */
const CHANNEL = "opencode-file-find"

/** The open bar: what it searches, the query, and the active match out of `count`. */
type PreviewFindState = {
  target: HTMLElement
  query: string
  index: number
  count: number
  pos: { top: number; right: number }
}

/** The marked ranges of a rendered preview, and the bar's input. */
type PreviewFindDom = { ranges: Range[]; input?: HTMLInputElement }

/** A frame the observer waits for, so a burst of mutations searches once. */
type PendingFrame = { frame?: number }

/**
 * Find for previews the code view's find can't search: rendered Markdown, Mermaid and tables by their text, and HTML
 * through a script added to the page, since the preview runs in a sandboxed frame. It uses the code view's bar and
 * marks, so both look the same.
 */
export function createPreviewFind(input: { root: () => HTMLElement | undefined; active: () => boolean }) {
  const [state, setState] = createSignal<PreviewFindState>()
  const local: PreviewFindDom = { ranges: [] }

  const update = (next: Partial<PreviewFindState>) => {
    const current = untrack(state)

    if (current) setState({ ...current, ...next })
  }

  const search = (query: string, index: number, scroll = true) => {
    const current = untrack(state)

    if (!current) return

    if (current.target instanceof HTMLIFrameElement) {
      update({ query, index })
      current.target.contentWindow?.postMessage({ source: CHANNEL, op: "search", query, index, marks: marks() }, "*")

      return
    }

    local.ranges = query ? documentRanges(current.target, query) : []
    const at = local.ranges.length === 0 ? 0 : Math.min(index, local.ranges.length - 1)
    update({ query, index: at, count: local.ranges.length })
    paint(at, scroll)
  }

  const paint = (index: number, scroll: boolean) => {
    if (!globalThis.CSS?.highlights) return
    const active = local.ranges[index]
    CSS.highlights.set(HIT, new Highlight(...local.ranges.filter((range) => range !== active)))

    if (!active) return CSS.highlights.delete(ACTIVE)
    CSS.highlights.set(ACTIVE, new Highlight(active))

    if (scroll) active.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" })
  }

  // Where the code view puts its bar, so it stays put when the preview switches to the source.
  const position = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect()

    return { top: Math.round(rect.top) - 4, right: Math.round(window.innerWidth - rect.right) + 8 }
  }

  /** Opens the bar for the shown preview; false when none is showing, so the code view's find runs instead. */
  const open = () => {
    const el = input.root()?.querySelector<HTMLElement>("[data-file-find]")

    // A closed side panel keeps its preview mounted but hidden; the bar would open off screen.
    if (!el?.checkVisibility()) return false
    const current = untrack(state)

    if (current?.target !== el) {
      close()
      setState({ target: el, query: current?.query ?? "", index: 0, count: 0, pos: position(el) })
    }

    search(untrack(state)?.query ?? "", 0)
    requestAnimationFrame(() => {
      local.input?.focus()
      local.input?.select()
    })

    return true
  }

  const close = () => {
    const current = untrack(state)

    if (!current) return
    local.ranges = []
    CSS.highlights?.delete(HIT)
    CSS.highlights?.delete(ACTIVE)

    if (current.target instanceof HTMLIFrameElement)
      current.target.contentWindow?.postMessage({ source: CHANNEL, op: "clear" }, "*")
    setState(undefined)
  }

  const next = (dir: 1 | -1) => {
    const current = untrack(state)

    if (!current?.query || current.count === 0) return
    const index = (current.index + dir + current.count) % current.count

    if (current.target instanceof HTMLIFrameElement) return search(current.query, index)
    update({ index })
    paint(index, true)
  }

  // The HTML preview's script answers searches, says when its page loaded, and passes on Mod+F pressed inside it,
  // which never reaches this window's key handlers.
  makeEventListener(window, "message", (event: MessageEvent) => {
    const frame = input.root()?.querySelector<HTMLIFrameElement>('iframe[data-file-find="frame"]')

    if (!frame || event.source !== frame.contentWindow) return
    const decoded = decodeFrameMessage(event.data)

    if (Option.isNone(decoded)) return
    const data = decoded.value

    if (data.op === "shortcut") {
      if (input.active()) open()

      return
    }

    const current = untrack(state)

    if (current?.target !== frame) return

    if (data.op === "ready") return search(current.query, current.index)

    if (data.op === "result" && data.query === current.query) update({ count: data.count, index: data.index })
  })

  // Keep the bar on its preview, search text that renders again, and close once the preview is gone, e.g. on a
  // switch to the source, whose code view has its own find.
  createKeyed(
    () => state()?.target,
    (el) => {
      const root = input.root()
      const pending: PendingFrame = {}

      const observer = new MutationObserver(() => {
        if (pending.frame !== undefined) return
        pending.frame = requestAnimationFrame(() => {
          pending.frame = undefined

          if (!el.isConnected) return close()

          if (el instanceof HTMLIFrameElement) return
          const current = untrack(state)

          // Text that renders again keeps the active match without scrolling to it.
          if (current) search(current.query, current.index, false)
        })
      })

      if (root) observer.observe(root, { childList: true, subtree: true, characterData: true })
      const reposition = () => update({ pos: position(el) })
      makeEventListener(window, "resize", reposition, { passive: true })
      createResizeObserver(el, reposition)
      onCleanup(() => {
        observer.disconnect()

        if (pending.frame !== undefined) cancelAnimationFrame(pending.frame)
      })
    },
  )

  createKeyed(() => !input.active(), close)

  onCleanup(close)

  return {
    state,
    open,
    close,
    next,
    setInput: (el: HTMLInputElement) => {
      local.input = el
    },
    setQuery: (query: string) => search(query, 0),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()

        return
      }

      if (event.key !== "Enter") return
      event.preventDefault()
      next(event.shiftKey ? -1 : 1)
    },
  }
}

export function PreviewFindBar(props: { find: ReturnType<typeof createPreviewFind> }) {
  return (
    <Show when={props.find.state()}>
      {(state) => (
        <FileSearchBar
          pos={state().pos}
          query={state().query}
          count={state().count}
          index={state().index}
          setInput={props.find.setInput}
          onInput={props.find.setQuery}
          onKeyDown={props.find.onKeyDown}
          onClose={props.find.close}
          onPrev={() => props.find.next(-1)}
          onNext={() => props.find.next(1)}
        />
      )}
    </Show>
  )
}

/**
 * The HTML with the find script first, after any doctype so the page keeps its rendering mode. The script runs before
 * the page's own, so a Content-Security-Policy the page declares later does not block it.
 */
export function findableHtml(content: FileContent): FileContent {
  if (content.type !== "text" || content.url || content.bytes) return content
  const script = `<script>(${frameFind.toString()})(${JSON.stringify(CHANNEL)})</script>`
  const doctype = /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(content.content)?.[0] ?? ""

  return { ...content, content: doctype + script + content.content.slice(doctype.length) }
}

/** The page's colors can't resolve the app's theme, so the marks travel resolved with each search. */
function marks() {
  const probe = document.createElement("span")
  document.body.append(probe)
  probe.style.backgroundColor = "rgb(from var(--surface-warning-base) r g b / 0.35)"
  const hit = getComputedStyle(probe).backgroundColor
  probe.style.backgroundColor = "rgb(from var(--surface-warning-strong) r g b / 0.55)"
  const active = getComputedStyle(probe).backgroundColor
  probe.remove()

  return { hit, active }
}

/** What the HTML preview's script sends; the page's own scripts can post to this window too. */
const decodeFrameMessage = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ source: Schema.Literal(CHANNEL), op: Schema.Literals(["ready", "shortcut"]) }),
    Schema.Struct({
      source: Schema.Literal(CHANNEL),
      op: Schema.Literal("result"),
      query: Schema.String,
      count: Schema.Number,
      index: Schema.Number,
    }),
  ]),
)

/** Every case-insensitive occurrence of `query` in the text under `root`, in reading order. */
function documentRanges(root: HTMLElement, query: string) {
  const needle = query.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const ranges: Range[] = []

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue
    const hay = node.data.toLowerCase()

    // Text the preview hides, such as a diagram's source, can't be shown as a match.
    if (!hay.includes(needle) || !node.parentElement?.checkVisibility()) continue

    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }

  return ranges
}

/**
 * Runs inside the HTML preview, serialized into its page, so it can use nothing from this module. It finds and marks
 * text the way the bar does for other previews, and hands Mod+F back to the app.
 */
function frameFind(channel: string) {
  const post = (
    message: { op: "ready" | "shortcut" } | { op: "result"; query: string; count: number; index: number },
  ) => parent.postMessage({ source: channel, ...message }, "*")

  // An adopted sheet, since a style element would fall to the page's own Content-Security-Policy.
  const sheet = new CSSStyleSheet()

  window.addEventListener("message", (event) => {
    const data = event.data

    if (event.source !== parent || data?.source !== channel) return
    const api = CSS.highlights

    if (data.op === "clear") {
      api?.delete("opencode-file-find")
      api?.delete("opencode-file-find-current")

      return
    }

    if (data.op !== "search") return
    const query = String(data.query)
    const needle = query.toLowerCase()
    const ranges: Range[] = []
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)

    for (let node = walker.nextNode(); node && needle; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue
      const hay = node.data.toLowerCase()

      if (!hay.includes(needle) || !node.parentElement?.checkVisibility()) continue

      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        ranges.push(range)
      }
    }

    const index = ranges.length === 0 ? 0 : Math.min(Math.max(data.index, 0), ranges.length - 1)
    const active = ranges[index]
    sheet.replaceSync(
      `::highlight(opencode-file-find){background-color:${data.marks?.hit}}::highlight(opencode-file-find-current){background-color:${data.marks?.active}}`,
    )

    if (!document.adoptedStyleSheets.includes(sheet))
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

    if (api) {
      api.set("opencode-file-find", new Highlight(...ranges.filter((range) => range !== active)))

      if (active) api.set("opencode-file-find-current", new Highlight(active))
      else api.delete("opencode-file-find-current")
    }

    active?.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" })
    post({ op: "result", query, count: ranges.length, index })
  })

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      post({ op: "shortcut" })
    },
    true,
  )

  window.addEventListener("DOMContentLoaded", () => post({ op: "ready" }))
}

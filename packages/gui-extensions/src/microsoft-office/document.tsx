import { createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Loader } from "@opencode/ui/loader"
import { createKeyed, createLatest, useExtension } from "../sdk"
import { OfficePages, type PaintPage, type ScrollToPage } from "./pages"
import {
  layerFont,
  lineHeight,
  type WordLink,
  type WordMethods,
  type WordPageSize,
  type WordSpan,
} from "./word-protocol"
import { createWorkerClient, movableBuffer } from "./worker-rpc"
import type { FileViewerProps } from "../file/contract"

type Opened = {
  readonly pages: Accessor<readonly WordPageSize[]>
  /** The pages shown so far are the document's first; the rest are still being laid out. */
  readonly loading: Accessor<boolean>
  readonly paint: PaintPage
  /** The page's text layer. */
  readonly text: (index: number, signal: AbortSignal) => Promise<readonly WordSpan[]>
  /** Where a bookmark sits: its page and the height on it, in page pixels. Waits for the layout when it needs to. */
  readonly bookmark: (name: string) => Promise<{ readonly index: number; readonly y: number } | undefined>
  /** Lays the rest of the document out, a step at a time between paints; resolves with its page count. */
  readonly finish: () => Promise<number>
}

type Client = ReturnType<typeof createWorkerClient<WordMethods>>

/** Scrolls the page column; set once the column mounts. */
type Scroll = { to: ScrollToPage | undefined }

/** A value built on first use. */
type Lazy<T> = { value: T | undefined }

/**
 * A read-only, paginated Word document. Its engine runs in a worker of its own (`document.worker.ts`), which opens the
 * file, lays it out, builds and paints its pages and computes their text; the window only shows the bitmaps and the text
 * layer, so no engine work holds it. The worker loads only the Yrs engine: the parse and layout engines and the
 * collaboration code stay unloaded, and embedded fonts give way to the bundled metric-compatible faces. The first pages
 * show as soon as they are laid out, and the rest lay out in short steps between paints. A transparent text layer over
 * each page makes its text selectable, findable and readable, and its links followable.
 */
export default function OfficeDocument(props: FileViewerProps) {
  const ctx = useExtension()
  const [opened, setOpened] = createSignal<Opened>()

  // Syncs one document worker with the loaded bytes. Terminating it is what frees the engine's memory.
  createKeyed(
    () => props.bytes,
    (bytes) => {
      const controller = new AbortController()
      const worker = new Worker(new URL("./document.worker.ts", import.meta.url), { type: "module" })
      const client = createWorkerClient<WordMethods>(worker)

      const fail = () => {
        if (controller.signal.aborted) return

        controller.abort()
        props.onError()
      }

      // A worker that dies after the pages showed takes them with it.
      worker.addEventListener("error", fail)
      worker.addEventListener("messageerror", fail)
      onCleanup(() => {
        controller.abort()
        client.close()
        setOpened(undefined)
      })

      void open(client, bytes)
        .then((value) => {
          if (controller.signal.aborted) return

          setOpened(value)

          // The worker runs calls in order, so the full layout waits until the first pages have asked for their paints:
          // they do once the column is laid out and its observer reports them, which takes up to two frames.
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            .then(() => (controller.signal.aborted ? undefined : value.finish()))
            .then((count) => {
              if (count !== undefined && !controller.signal.aborted) props.onDetails([ctx.plural("pages", count)])
            })
        })
        .catch(fail)
    },
  )

  return (
    <Show
      when={opened()}
      fallback={
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <Loader />
        </div>
      }
    >
      {(opened) => {
        const scroll: Scroll = { to: undefined }

        const follow = (link: WordLink) => {
          if (link.kind === "external") return ctx.system.openExternal(link.url)

          void opened()
            .bookmark(link.bookmark)
            .then(
              (target) => {
                if (target) scroll.to?.(target.index, target.y)
              },
              () => undefined,
            )
        }

        return (
          <OfficePages
            pages={opened().pages()}
            maxScale={1}
            paint={opened().paint}
            label={(index) => ctx.t("page", { number: index + 1 })}
            overlay={(input) => (
              <WordTextLayer
                index={input.index}
                page={opened().pages()[input.index]}
                text={opened().text}
                follow={follow}
              />
            )}
            text
            footer={(index) => (
              <Show when={opened().loading() && index === opened().pages().length - 1}>
                <Loader />
              </Show>
            )}
            onScrollTo={(scrollTo) => {
              scroll.to = scrollTo
            }}
          />
        )
      }}
    </Show>
  )
}

/**
 * Transparent text over a page's painted glyphs. Positions are fractions of the page and sizes fractions of its width
 * (container query units), so the layer tracks the page's CSS size at once while a resize waits to repaint.
 */
function WordTextLayer(props: {
  index: number
  /** The page's size object, which the full layout replaces when it changes the page. */
  page: WordPageSize | undefined
  text: (index: number, signal: AbortSignal) => Promise<readonly WordSpan[]>
  follow: (link: WordLink) => void
}) {
  // A changed page asks for its text again; the old text stays until the new arrives.
  const spans = createLatest(
    () => props.page,
    (_, signal) => props.text(props.index, signal),
  )

  return (
    <div
      class="absolute inset-0 select-text overflow-hidden whitespace-pre text-transparent [container-type:inline-size] selection:bg-[rgb(0_120_215/0.3)] selection:text-transparent"
      // Separators flow at the layer's corner; at no size they keep words and paragraphs apart in copied text unseen.
      style={{ "font-family": layerFont, "font-size": "0", "line-height": lineHeight }}
    >
      <For each={spans.latest}>
        {(span) => (
          <>
            <Show
              when={span.link}
              fallback={
                <span dir={span.dir} class="absolute origin-top-left cursor-text" style={place(span)}>
                  {span.text}
                </span>
              }
            >
              {(link) => (
                <span
                  role="link"
                  tabIndex={0}
                  title={span.title}
                  dir={span.dir}
                  class="absolute origin-top-left cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
                  style={place(span)}
                  onClick={(event) => {
                    // A drag that ends on the link selects text instead of following it.
                    if (event.button === 0 && (globalThis.getSelection()?.isCollapsed ?? true)) props.follow(link())
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return

                    event.preventDefault()
                    props.follow(link())
                  }}
                >
                  {span.text}
                </span>
              )}
            </Show>
            <Show when={span.after === "br"}>
              <br />
            </Show>
            <Show when={span.after === "tab"}>{"\t"}</Show>
          </>
        )}
      </For>
    </div>
  )
}

function place(span: WordSpan) {
  return {
    left: `${span.left * 100}%`,
    top: `${span.top * 100}%`,
    "font-size": `${span.size * 100}cqw`,
    transform: span.transform,
  }
}

/** Opens the bytes in the worker and returns as soon as the document's first pages can show. */
async function open(client: Client, bytes: Uint8Array): Promise<Opened> {
  // The view owns its bytes, so they move to the worker rather than being copied.
  const buffer = movableBuffer(bytes)
  const first = await client.call("open", { bytes: buffer }, { transfer: [buffer] })
  const [layout, setLayout] = createStore({ pages: first.pages, loading: first.loading })

  const layOut = async (): Promise<number> => {
    const step = await client.call("layout", undefined)

    if (!step.done) return layOut()

    // A page keeps its object, and so its bitmap and text layer, unless the full layout changed it. A changed page
    // keeps its row and paints again over its old bitmap.
    const sizes = step.pages.map((page, index) => {
      const size = layout.pages[index]

      return size && step.kept[index] && sameSize(size, page) ? size : page
    })

    // The column mounts the new rows a slice at a time.
    setLayout({ pages: sizes, loading: false })

    return sizes.length
  }

  const rest: Lazy<Promise<number>> = { value: undefined }
  // Each page's text layer, kept for its page object: a page that scrolls back into view shows it without asking the
  // worker. A page the full layout changed gets a new object, and asks again.
  const texts = new WeakMap<WordPageSize, readonly WordSpan[]>()
  const pages = () => layout.pages
  const loading = () => layout.loading

  const finish = () => (rest.value ??= loading() ? layOut() : Promise.resolve(pages().length))

  return {
    pages,
    loading,
    finish,
    paint: async (index, canvas, scale, signal) => {
      const painted = client.call(
        "paint",
        { index, scale, ratio: window.devicePixelRatio || 1 },
        // A newer paint of the page, such as at another scale, replaces this one while it waits, and a page that
        // scrolled away withdraws it.
        { key: `paint:${index}`, signal },
      )

      // Builds the next page after the paints waiting, so scrolling on rarely waits for it. Pages stay unbuilt beyond
      // that, and a paint releases the pages far from its own: each built page holds megabytes in the engine.
      void client.call("build", { index: index + 1 }, { key: "build" }).catch(() => undefined)

      // A withdrawn paint rejects here, and the worker closes any bitmap it made for it.
      const bitmap = await painted

      if (!bitmap) return

      const context = canvas.getContext("bitmaprenderer")

      if (!context) return bitmap.close()

      canvas.width = bitmap.width
      canvas.height = bitmap.height
      context.transferFromImageBitmap(bitmap)
    },
    text: async (index, signal) => {
      const page = pages()[index]
      const cached = page && texts.get(page)

      if (cached) return cached

      const spans = await client.call("text", { index }, { signal })

      if (page) texts.set(page, spans)

      return spans
    },
    bookmark: async (name) => {
      const found = await client.call("bookmark", { name })

      // The bookmark may sit past the pages laid out so far.
      if (found || !loading()) return found

      await finish()

      return client.call("bookmark", { name })
    },
  }
}

function sameSize(size: WordPageSize, page: WordPageSize) {
  return size.width === page.width && size.height === page.height && size.background === page.background
}

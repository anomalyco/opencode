import "./share.css"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { drawShareCard, loadShareFonts, shareDuration, shareSizes, type ShareCard, type ShareOptions } from "./card"
import { cycleShareOption, designMode, shareControls, shareOptions } from "./design"

export type ShareDraft = Omit<ShareCard, "updatedAt" | "url">

const [request, setRequest] = createSignal<ShareDraft>()

/** The share icon in a section's heading. `card` reads the section's current view when it's pressed. */
export function ShareButton(props: { card: () => ShareDraft | undefined; label: string }) {
  return (
    <button
      type="button"
      data-component="share-button"
      aria-label={props.label}
      title={props.label}
      aria-haspopup="dialog"
      aria-expanded={request()?.id === props.card()?.id ? "true" : "false"}
      onClick={(event) => {
        const card = props.card()
        if (!card) return
        opener = event.currentTarget
        setRequest(card)
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5 4.5 5h2.75v5.5h1.5V5h2.75L8 1.5Z" fill="currentColor" />
        <path d="M3 8v6h10V8h-1.5v4.5h-7V8H3Z" fill="currentColor" />
      </svg>
    </button>
  )
}

let opener: HTMLElement | undefined

/** The share dialog, mounted once on the page: a preview of the card, then ways to share it as an image or video. */
export function ShareDialog(props: { updatedAt: string | null; url: string }) {
  let dialog: HTMLDialogElement | undefined
  let preview: HTMLCanvasElement | undefined
  const [format, setFormat] = createSignal<"image" | "video">("image")
  const [headline, setHeadline] = createSignal("")
  const [status, setStatus] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const card = createMemo(() => {
    const value = request()
    if (!value) return undefined
    return { ...value, updatedAt: props.updatedAt, url: props.url, headline: headline() || value.headline }
  })
  // A copy of the options, so reading them tracks every field.
  const options = createMemo<ShareOptions>(() => ({ ...shareOptions }))
  const size = createMemo(() => shareSizes[options().size])
  let video: { key: string; file: Promise<File> } | undefined

  createEffect(() => {
    const value = request()
    if (!value) return
    setHeadline(value.headline)
    setStatus(undefined)
    dialog?.showModal()
    void loadShareFonts().then(() => setReady(true))
  })

  // The preview: the still for an image, the animation on a loop for a video.
  createEffect(() => {
    const value = card()
    const opts = options()
    if (!value || !preview || !ready()) return
    const ctx = preview.getContext("2d")
    if (!ctx) return
    preview.width = size()[0]
    preview.height = size()[1]
    if (format() === "image" || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return drawShareCard(ctx, value, opts, Infinity)
    const length = shareDuration(value, opts)
    const start = performance.now()
    const frame = () => {
      drawShareCard(ctx, value, opts, ((performance.now() - start) / 1000) % (length + 0.6))
      handle = requestAnimationFrame(frame)
    }
    let handle = requestAnimationFrame(frame)
    onCleanup(() => cancelAnimationFrame(handle))
  })

  const close = () => {
    dialog?.close()
  }

  const file = () => {
    const value = card()
    if (!value) return Promise.reject(new Error("No card"))
    if (format() === "image") return renderImage(value, options())
    const key = JSON.stringify([value, options()])
    if (video?.key !== key) {
      setBusy(true)
      setStatus("Rendering video…")
      video = {
        key,
        file: renderVideo(value, options(), (progress) =>
          setStatus(`Rendering video ${Math.round(progress * 100)}%`),
        ).finally(() => {
          setBusy(false)
          setStatus(undefined)
        }),
      }
    }
    return video.file
  }

  const run = async (action: () => Promise<string | undefined>) => {
    try {
      const message = await action()
      if (message) setStatus(message)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setStatus(error instanceof Error ? error.message : "Something went wrong")
    }
  }

  const share = () =>
    run(async () => {
      const value = card()
      const shared = await file()
      if (!value) return
      const data = { files: [shared], title: value.title, text: `${value.headline} ${value.url}` }
      if (navigator.canShare?.(data)) {
        await navigator.share(data)
        return undefined
      }
      download(shared)
      return "Saved. Attach it to your post."
    })

  const copyImage = () =>
    run(async () => {
      const value = card()
      if (!value) return
      // Safari needs the clipboard write to start in the click, with the image as a promise.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": renderImage(value, options()) })])
      return "Image copied"
    })

  const save = () =>
    run(async () => {
      download(await file())
      return undefined
    })

  const copyLink = () =>
    run(async () => {
      const value = card()
      if (!value) return
      await navigator.clipboard.writeText(link(value))
      return "Link copied"
    })

  const post = () => {
    const value = card()
    if (!value) return
    const text = encodeURIComponent(value.headline)
    window.open(`https://x.com/intent/post?text=${text}&url=${encodeURIComponent(link(value))}`, "_blank", "noopener")
  }

  return (
    <dialog
      ref={dialog}
      data-component="share-dialog"
      aria-label="Share"
      onClose={() => {
        setRequest(undefined)
        setReady(false)
        setFormat("image")
        opener?.focus()
      }}
      onClick={(event) => {
        if (event.target === dialog) close()
      }}
    >
      <Show when={card()}>
        {(value) => (
          <div data-slot="share-panel">
            <div data-slot="share-stage">
              <Show when={designMode()}>
                <div data-component="share-design" aria-label="Design mode">
                  <For each={shareControls}>
                    {(control) => {
                      const index = () => control.options.findIndex((option) => option[0] === options()[control.key])
                      return (
                        <div data-slot="control">
                          <button
                            type="button"
                            aria-label={`Previous ${control.label}`}
                            onClick={() => cycleShareOption(control.key, -1)}
                          >
                            ‹
                          </button>
                          <span data-slot="value">
                            <span data-slot="label">{control.label}</span>
                            {control.options[index()]?.[1]}
                            <span data-slot="count">
                              {index() + 1}/{control.options.length}
                            </span>
                          </span>
                          <button
                            type="button"
                            aria-label={`Next ${control.label}`}
                            onClick={() => cycleShareOption(control.key, 1)}
                          >
                            ›
                          </button>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <canvas
                ref={preview}
                data-slot="share-preview"
                role="img"
                aria-label={value().headline}
                style={{ "aspect-ratio": `${size()[0]} / ${size()[1]}` }}
              />
            </div>
            <div data-slot="share-side">
              <div data-slot="share-head">
                <h2>Share {value().title}</h2>
                <button type="button" data-slot="share-close" aria-label="Close" onClick={close}>
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </button>
              </div>
              <div data-component="usage-filter" data-variant="range" role="group" aria-label="Format">
                <For each={["image", "video"] as const}>
                  {(item) => (
                    <button
                      type="button"
                      data-active={format() === item ? "true" : undefined}
                      aria-pressed={format() === item}
                      onClick={() => setFormat(item)}
                    >
                      {item === "image" ? "Image" : "Video"}
                    </button>
                  )}
                </For>
              </div>
              <label data-slot="share-field">
                <span>Headline</span>
                <textarea rows={3} value={headline()} onInput={(event) => setHeadline(event.currentTarget.value)} />
              </label>
              <div data-slot="share-actions">
                <button type="button" data-variant="primary" disabled={busy()} onClick={share}>
                  Share {format() === "image" ? "image" : "video"}
                </button>
                <Show when={format() === "image"}>
                  <button type="button" onClick={copyImage}>
                    Copy image
                  </button>
                </Show>
                <button type="button" disabled={busy()} onClick={save}>
                  Download {format() === "image" ? "PNG" : "video"}
                </button>
                <button type="button" onClick={copyLink}>
                  Copy link
                </button>
                <button type="button" onClick={post}>
                  Post on X
                </button>
              </div>
              <p data-slot="share-status" role="status" aria-live="polite">
                {status() ??
                  `${size()[0]} × ${size()[1]}${format() === "video" ? `, ${Math.round(shareDuration(value(), options()))}s` : ""}`}
              </p>
            </div>
          </div>
        )}
      </Show>
    </dialog>
  )
}

function link(card: ShareCard) {
  return `https://${card.url}/#${card.id}`
}

function fileName(card: ShareCard, extension: string) {
  return `opencode-data-${card.id}-${new Date().toISOString().slice(0, 10)}.${extension}`
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function renderImage(card: ShareCard, options: ShareOptions) {
  await loadShareFonts()
  const canvas = document.createElement("canvas")
  const [width, height] = shareSizes[options.size]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is not available")
  drawShareCard(ctx, card, options, Infinity)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Could not make the image")
  return new File([blob], fileName(card, "png"), { type: "image/png" })
}

// Records the animation in real time from a canvas stream. MP4 where the browser can record it (Safari, Chrome),
// WebM otherwise.
async function renderVideo(card: ShareCard, options: ShareOptions, progress: (value: number) => void) {
  await loadShareFonts()
  const type = ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((item) =>
    MediaRecorder.isTypeSupported(item),
  )
  if (!type) throw new Error("This browser can't record video")
  const canvas = document.createElement("canvas")
  const [width, height] = shareSizes[options.size]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is not available")
  drawShareCard(ctx, card, options, 0)
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => chunks.push(event.data)
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))
  const length = shareDuration(card, options)
  recorder.start()
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const frame = () => {
      const time = (performance.now() - start) / 1000
      drawShareCard(ctx, card, options, time)
      progress(Math.min(1, time / length))
      if (time >= length) return resolve()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  recorder.stop()
  await done
  const base = type.split(";")[0] ?? "video/webm"
  return new File([new Blob(chunks, { type: base })], fileName(card, base === "video/mp4" ? "mp4" : "webm"), {
    type: base,
  })
}

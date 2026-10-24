import { resolveBlobUrl } from "@/runtime/persistence/drafts"

type Entry = { users: number; url?: string; ready: Promise<string | undefined> }

const thumbnails = new Map<string, Entry>()

// A separate raster keeps large originals out of the composer's paint/decode cache. The
// attachment's original blob is still used by the full preview, persistence and submission.
export function attachmentThumbnail(blob: { id: string; url?: string }) {
  const cached = thumbnails.get(blob.id)
  const entry: Entry = cached ?? { users: 0, ready: Promise.resolve(undefined) }
  entry.users++

  if (!cached) {
    thumbnails.set(blob.id, entry)
    entry.ready = resolveBlobUrl(blob)
      .then((url) => (url ? thumbnail(url) : undefined))
      .then((image) => {
        if (!image || !entry.users) return
        entry.url = URL.createObjectURL(image)

        return entry.url
      })
      // A missing or unsupported image keeps its clickable placeholder, never the large raster.
      .catch(() => undefined)
  }

  let released = false

  return {
    ready: entry.ready,
    release() {
      if (released) return
      released = true

      if (--entry.users) return
      thumbnails.delete(blob.id)

      if (entry.url) URL.revokeObjectURL(entry.url)
    },
  }
}

async function thumbnail(url: string) {
  // Loading an off-DOM image reads its dimensions without painting the full-size raster.
  const image = new Image()

  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = url
  }).finally(() => {
    image.onload = null
    image.onerror = null
    image.removeAttribute("src")
  })

  const scale = Math.min(1, 232 / size.width, 184 / size.height)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))

  return rasterize(url, width, height)
}

// Even createImageBitmap's resize can occupy the renderer on large images. One worker processes
// the queue serially to avoid concurrent large decodes and exits as soon as the queue drains.
let worker: Worker | undefined

let nextID = 0

const pending = new Map<number, (blob: Blob | undefined) => void>()

function rasterize(url: string, width: number, height: number) {
  worker ??= new Worker(new URL("./thumbnail.worker.ts", import.meta.url), { type: "module" })
  worker.onmessage = (event: MessageEvent<{ id: number; blob?: Blob }>) => {
    pending.get(event.data.id)?.(event.data.blob)
    pending.delete(event.data.id)

    if (pending.size) return
    worker?.terminate()
    worker = undefined
  }

  worker.onerror = () => {
    pending.forEach((resolve) => resolve(undefined))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }

  const id = nextID++

  return new Promise<Blob | undefined>((resolve) => {
    pending.set(id, resolve)
    worker!.postMessage({ id, url, width, height })
  })
}

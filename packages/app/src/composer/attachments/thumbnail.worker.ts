export type ThumbnailRequest = { id: number; url: string; width: number; height: number }

let queue = Promise.resolve()

self.onmessage = (event: MessageEvent<ThumbnailRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    const blob = await thumbnail(request).catch(() => undefined)
    self.postMessage({ id: request.id, blob })
  })
}

async function thumbnail({ url, width, height }: ThumbnailRequest) {
  const blob = await fetch(url).then((response) => response.blob())
  const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" })

  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d")

    if (!context) return
    context.drawImage(bitmap, 0, 0)

    return await canvas.convertToBlob({ type: "image/png" })
  } finally {
    bitmap.close()
  }
}

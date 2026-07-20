const cacheName = "opencode-background-image-v1"
const maxBytes = 20 * 1024 * 1024

function key() {
  return new URL("/__opencode/background-image", location.origin).toString()
}

export async function loadWebBackgroundImage() {
  const response = await (await caches.open(cacheName)).match(key())
  return response?.blob() ?? null
}

export async function saveWebBackgroundImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Unsupported background image format")
  if (file.size > maxBytes) throw new Error("Background images must be 20 MB or smaller")
  await (await caches.open(cacheName)).put(key(), new Response(file, { headers: { "Content-Type": file.type } }))
  return file
}

export async function clearWebBackgroundImage() {
  await (await caches.open(cacheName)).delete(key())
}

export function selectWebBackgroundImage() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/avif,image/bmp,image/gif,image/jpeg,image/png,image/webp"
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

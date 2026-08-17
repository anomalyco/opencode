const supportedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

export function supportedImageMime(mime: string) {
  return supportedImageMimes.has(mime.toLowerCase())
}

export function mediaLabel(file: { filename?: string; mime: string }) {
  return file.filename || file.mime || "Attachment"
}

// Responses image items can omit output_format, including when PNG/JPEG was requested.
export const mediaType = (data: Uint8Array, format?: string) => {
  if (format !== undefined) return `image/${format}`
  if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) return "image/png"
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg"
  if (new TextDecoder().decode(data.slice(0, 4)) === "RIFF" && new TextDecoder().decode(data.slice(8, 12)) === "WEBP")
    return "image/webp"
  return "application/octet-stream"
}

export * as MetaImage from "./meta-image.js"

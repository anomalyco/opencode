import { mapCharacter } from "./mapping"

// The font builder, the GIF worker and the confetti are plain modules in public/font, fetched
// only when needed.
export const fontAsset = (path: string) => new URL(`/font/${path}`, window.location.origin).href

export function downloadFile(file: Blob, filename: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Builds OpenCode.otf with this visit's character map and downloads it. Returns a status message. */
export async function downloadFont() {
  try {
    const [opentype, font] = await Promise.all([
      import(/* @vite-ignore */ fontAsset("vendor/opentype.js")),
      import(/* @vite-ignore */ fontAsset("font.mjs")),
    ])
    const file = font.createLogoFont(opentype, mapCharacter)
    downloadFile(new Blob([file.toArrayBuffer()], { type: "font/otf" }), font.FONT_FILENAME)
    return "Font downloaded. Open the file to install it, then select OpenCode in your app."
  } catch (error) {
    console.error("Font export failed:", error)
    return "Could not create the font. Please try again."
  }
}

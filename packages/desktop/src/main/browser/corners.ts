import { nativeImage } from "electron"

// Native browser surfaces ignore a parent View's clip path. Cover only the
// pixels outside the bottom arcs; never resize or style the page itself.
export function createCornerImages(color: readonly [number, number, number, number], radius: number, scale: number) {
  const size = Math.max(1, Math.round(radius * scale))
  return [false, true].map((right) => {
    const pixels = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(right ? x + 0.5 : size - x - 0.5, y + 0.5)
        const alpha = Math.round(color[3] * Math.max(0, Math.min(1, distance - size + 0.5)))
        const offset = (y * size + x) * 4
        // NativeImage bitmaps use premultiplied BGRA on supported desktop platforms.
        pixels[offset] = Math.round((color[2] * alpha) / 255)
        pixels[offset + 1] = Math.round((color[1] * alpha) / 255)
        pixels[offset + 2] = Math.round((color[0] * alpha) / 255)
        pixels[offset + 3] = alpha
      }
    }
    return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: scale })
  })
}

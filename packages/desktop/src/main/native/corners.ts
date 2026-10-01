import { nativeImage } from "electron"

type Color = readonly [number, number, number, number]

// Native browser surfaces ignore a parent View's clip path. Cover only the
// pixels outside the bottom arcs; never resize or style the page itself.
// The card's ring sits just outside the arc, inside these masks, so draw it here.
export function createCornerImages(
  color: Color,
  radius: number,
  scale: number,
  border?: { readonly color: Color; readonly width: number },
) {
  const size = Math.max(1, Math.round(radius * scale))
  const ring = (border?.width ?? 0) * scale
  const coverage = (edge: number, distance: number) => Math.max(0, Math.min(1, edge - distance + 0.5))

  return [false, true].map((right) => {
    const pixels = Buffer.alloc(size * size * 4)

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(right ? x + 0.5 : size - x - 0.5, y + 0.5)
        const inside = coverage(size, distance)
        const base = ((1 - inside) * color[3]) / 255
        const line = border ? ((coverage(size + ring, distance) - inside) * border.color[3]) / 255 : 0
        const channel = (index: number) =>
          Math.round((border ? border.color[index] : 0) * line + color[index] * base * (1 - line))
        const offset = (y * size + x) * 4
        // NativeImage bitmaps use premultiplied BGRA on supported desktop platforms.
        pixels[offset] = channel(2)
        pixels[offset + 1] = channel(1)
        pixels[offset + 2] = channel(0)
        pixels[offset + 3] = Math.round(255 * (line + base * (1 - line)))
      }
    }

    return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: scale })
  })
}

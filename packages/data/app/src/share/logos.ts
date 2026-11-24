// Provider logos for the share cards' big, faint watermarks: each symbol from the site's provider sprite (the one
// ProviderIcon uses) as an image, in white for the dark card and black for the light one. The sprite is large, so it
// loads only when a card needs a logo, once; the card draws a logo once its image has loaded.
import sprite from "../../../../ui/src/components/provider-icons/sprite.svg?url"
import type { ShareChart } from "./card"

const inks = ["#ffffff", "#000000"] as const
const images = new Map<string, HTMLCanvasElement>()
let text: Promise<string> | undefined

export async function loadShareLogos(ids: string[]) {
  text ??= fetch(sprite).then((response) => response.text())
  const source = await text
  await Promise.all(
    ids.flatMap((id) =>
      inks.map((ink) => {
        const key = `${id} ${ink}`
        if (images.has(key)) return undefined
        const symbol = new RegExp(`<symbol([^>]*)id="${id}"([^>]*)>([\\s\\S]*?)</symbol>`).exec(source)
        if (!symbol) return undefined
        const box = /viewBox="([^"]+)"/.exec(`${symbol[1]} ${symbol[2]}`)?.[1] ?? "0 0 40 40"
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="480" height="480">${symbol[3]}</svg>`,
        )}`
        // Some logos carry their own colours instead of currentColor; painting the ink over the shape makes every logo
        // one flat colour.
        return image
          .decode()
          .then(() => {
            const canvas = document.createElement("canvas")
            canvas.width = 480
            canvas.height = 480
            const ctx = canvas.getContext("2d")
            if (!ctx) return
            ctx.drawImage(image, 0, 0, 480, 480)
            ctx.globalCompositeOperation = "source-in"
            ctx.fillStyle = ink
            ctx.fillRect(0, 0, 480, 480)
            images.set(key, canvas)
          })
          .catch(() => undefined)
      }),
    ),
  )
}

/** The logo `id` in white (`dark`) or black, once loaded. */
export function shareLogo(id: string, dark: boolean) {
  return images.get(`${id} ${dark ? inks[0] : inks[1]}`)
}

/** The logos a card draws, for loading before it's shown or rendered. */
export function cardLogos(chart: ShareChart) {
  if (chart.kind === "podium") return chart.entries.map((entry) => entry.logo)
  if (chart.kind === "versus") return chart.models.map((model) => model.logo)
  return []
}

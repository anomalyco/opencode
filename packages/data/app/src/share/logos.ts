// Provider logos for the share cards' big, faint watermarks: each symbol from the site's provider sprite (the one
// ProviderIcon uses) as an image, in white for the dark card and black for the light one. The sprite is large, so it
// loads only when a card needs a logo, once; the card draws a logo once its image has loaded.
import sprite from "../../../../ui/src/components/provider-icons/sprite.svg?url"

import type { ShareChart } from "./card"

const inks = ["#ffffff", "#000000"] as const
const images = new Map<string, HTMLImageElement>()
let text: Promise<string> | undefined

export async function loadShareLogos(ids: string[]) {
  text ??= fetch(sprite).then((response) => response.text())
  const source = await text
  await Promise.all(
    ids.flatMap((id) =>
      inks.map((ink) => {
        const key = `${id} ${ink}`
        if (images.has(key))
          return images
            .get(key)
            ?.decode()
            .catch(() => undefined)
        const symbol = new RegExp(`<symbol([^>]*)id="${id}"([^>]*)>([\\s\\S]*?)</symbol>`).exec(source)
        if (!symbol) return undefined
        const box = /viewBox="([^"]+)"/.exec(`${symbol[1]} ${symbol[2]}`)?.[1] ?? "0 0 40 40"
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="480" height="480" style="color:${ink}">${symbol[3]}</svg>`,
        )}`
        images.set(key, image)
        return image.decode().catch(() => undefined)
      }),
    ),
  )
}

/** The logo `id` in white (`dark`) or black, once loaded. */
export function shareLogo(id: string, dark: boolean) {
  const image = images.get(`${id} ${dark ? inks[0] : inks[1]}`)
  return image?.complete && image.naturalWidth > 0 ? image : undefined
}

/** The logos a card draws, for loading before it's shown or rendered. */
export function cardLogos(chart: ShareChart) {
  if (chart.kind === "podium") return chart.entries.map((entry) => entry.logo)
  if (chart.kind === "versus") return chart.models.map((model) => model.logo)
  return []
}

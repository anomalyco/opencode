import { cardVideo } from "~/component/site/card-video"
import { siteSettings } from "~/component/site/settings"
import { browserPlatform } from "~/lib/user-agent"
import { $, $$ } from "../dom"

/**
 * A card's video (CardVideo in products.tsx): the carousel's and /product's cards, and a product
 * page's feature clips. card-video.ts plays it; this shows its state in the server's markup.
 */
export default function cardVideoIsland(media: HTMLElement) {
  const video = $<HTMLVideoElement>("video:not([data-slot])", media)
  const idle = $('video[data-slot="still"]', media)
  const image = $('img[data-slot="still"]:not([data-poster])', media)
  const stills = $$('[data-slot="still"]', media)
  if (!video) return
  const platform = browserPlatform()
  cardVideo(
    media,
    {
      mode: siteSettings.cardVideo,
      hover: siteSettings.cardHover,
      loopSpeed: siteSettings.cardLoopSpeed,
      demo: video.hasAttribute("data-demo"),
      matchesLoop: video.hasAttribute("data-matches-loop"),
      // A resting loop's cover, or a still that isn't the video's first frame (it crossfades).
      still: !!idle || image?.dataset.mode === "crossfade",
      mobile: platform === "ios" || platform === "android",
    },
    {
      still: (shown) => stills.forEach((still) => still.toggleAttribute("data-hidden", !shown)),
      preload: (level) => {
        if (video.preload !== "auto") video.preload = level
      },
      sizzle: () => {
        // The cover stays over it until a frame of it plays, so it needs no poster.
        video.removeAttribute("poster")
        if (idle) stills.forEach((still) => (still.dataset.mode = "sizzle"))
      },
      loaded: () => (idle ?? image)?.setAttribute("data-loaded", ""),
    },
  )
}

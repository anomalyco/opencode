// The frames the site shows each video in. Every one is `object-fit: cover`, centred, so a crop is the centred
// part of the output with this aspect ratio. Update this list when the site CSS changes.
export type Crop = { id: string; label: string; ratio: number; css: string }

export const crops: Record<"portrait" | "landscape" | "feature", Crop[]> = {
  portrait: [
    {
      id: "card",
      label: "Carousel card 4:5",
      ratio: 4 / 5,
      css: "products.css: [data-component=product-card] [data-slot=media] aspect-ratio 4/5",
    },
  ],
  landscape: [
    {
      id: "hero",
      label: "Hero 16:10",
      ratio: 16 / 10,
      css: "product-page.css: [data-component=product-hero] aspect-ratio 16/10",
    },
    {
      id: "hero-wide",
      label: "Hero 2:1 (wide or short window)",
      ratio: 2,
      css: "product-page.css: [data-slot=first-screen] max-height calc(100svh - var(--content-top) - 13rem), min-height 28rem; about 2:1 at 1440×900",
    },
    {
      id: "hero-narrow",
      label: "Hero 16:9 (< 60rem)",
      ratio: 16 / 9,
      css: "product-page.css: @media (max-width: 60rem) aspect-ratio 16/9",
    },
  ],
  feature: [
    {
      id: "feature",
      label: "Feature clip 16:10",
      ratio: 16 / 10,
      css: "product-page.css: [data-component=showcase] [data-slot=media] aspect-ratio 16/10",
    },
  ],
}

/** The centred rectangle of a W×H output that a crop shows, in output px. */
export function cropRect(size: [number, number], ratio: number) {
  const [W, H] = size
  if (ratio < W / H) return { x: (W - H * ratio) / 2, y: 0, w: H * ratio, h: H }
  return { x: 0, y: (H - W / ratio) / 2, w: W, h: W / ratio }
}

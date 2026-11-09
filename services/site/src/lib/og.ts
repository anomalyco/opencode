/** A page's link preview card: its file (a site path) and alt text, rendered by script/og.ts. */
export type OgImage = { src: string; alt: string }

// script/og.ts writes og-images.json before `vite dev` and `vite build`. A glob, not an import, so
// typecheck and tests also pass in a fresh checkout where the file does not exist yet.
const cards: Record<string, OgImage> =
  Object.values(import.meta.glob<Record<string, OgImage>>("./og-images.json", { eager: true, import: "default" }))[0] ??
  {}
const fallback: OgImage = { src: "/social-share.png", alt: "OpenCode" }

/**
 * The card for a page, by its English path; every locale shares the English card. script/og.ts
 * renders one for every page that has ShareMeta, and a page it doesn't know gets the home card.
 */
export function ogImage(path: string): OgImage {
  return cards[path] ?? cards["/"] ?? fallback
}

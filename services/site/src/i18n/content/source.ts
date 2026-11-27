import type { Translate } from "~/i18n"
import { byos } from "~/lib/byos"
import { brandContent } from "~/lib/brand-content"
import { downloadContent, pairContent } from "~/lib/download-content"
import { getStarted } from "~/lib/get-started"
import { pressContent } from "~/lib/press-content"
import { announcementsSource } from "./areas/announcements"
import { appsSource } from "./areas/apps"
import { extensionsSource } from "./areas/extensions"
import { productDetailsSource } from "./areas/product-details"
import { productDownloadsSource } from "./areas/product-downloads"
import { extensionCardSource, productsSource } from "./areas/products"
import type { Overlay } from "./paths"

/**
 * The structured page copy that lives beside its data (product-data.ts, extension-data.ts, links.ts),
 * gathered by area so each locale's file can translate it without touching hrefs, clips or commands.
 * The English data files stay the source of truth; the Markdown versions and llms.txt read them directly.
 * `t` is the English dict; script/i18n-slices.ts and i18n/check.ts pass their own.
 *
 * Pages don't load this whole: each reads its areas' English from content/areas (useArea), so a page
 * ships only the copy it shows. This gathers them for the checks and the `Content` type.
 */
export function contentSource(t: Translate) {
  return {
    products: productsSource,
    productDetails: productDetailsSource,
    extensionCard: extensionCardSource,
    extensions: extensionsSource,
    apps: appsSource,
    // Pages read these with their own localized links (`localize`); the source uses plain paths.
    getStarted: getStarted((path) => path),
    byos,
    // Leaves that come from the dict are translated there (src/i18n/<locale>.ts), not here.
    brand: brandContent(t),
    press: pressContent(t, (path) => path),
    download: downloadContent(t, (path) => path),
    productDownloads: productDownloadsSource,
    pair: pairContent(),
    announcements: announcementsSource,
  }
}

export type Content = ReturnType<typeof contentSource>

export type ContentOverlay = Overlay<Content>

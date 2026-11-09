import { allProductPages, extensions, productDetails, type PageSlug } from "~/component/site/product-data"
import { extensionPages, type ExtensionSlug } from "~/component/site/extension-data"
import { anomalyProducts } from "~/component/site/links"
import { announcements } from "~/component/site/announcement"
import { translator, type Translate } from "~/i18n"
import { brandContent } from "~/lib/brand-content"
import { byos } from "~/lib/byos"
import { downloadContent, pairContent, productDownloads } from "~/lib/download-content"
import { getStarted } from "~/lib/get-started"
import { pressContent } from "~/lib/press-content"

/**
 * The structured page copy that lives beside its data (product-data.ts, extension-data.ts, links.ts),
 * gathered by slug so each locale's file can translate it without touching hrefs, clips or commands.
 * The English data files stay the source of truth; the Markdown versions and llms.txt read them directly.
 * `t` is the English dict; i18n/check.ts passes a marking one to tell its leaves apart.
 */
export function contentSource(t: Translate) {
  return {
    products: Object.fromEntries(
      allProductPages.map((product) => [
        product.slug,
        { name: product.name, body: product.body, action: product.action },
      ]),
    ) as Record<PageSlug, { name: string; body: string; action: string }>,
    productDetails: Object.fromEntries(
      Object.entries(productDetails).map(([slug, detail]) => [
        slug,
        {
          title: detail.title,
          description: detail.description,
          intro: detail.intro,
          features: detail.features.map((feature) => ({ title: feature.title, body: feature.body })),
          showcase: detail.showcase.map((row) => ({ title: row.title, body: row.body })),
        },
      ]),
    ) as Record<
      PageSlug,
      {
        title: string
        description: string
        intro: string
        features: { title: string; body: string }[]
        showcase: { title: string; body: string }[]
      }
    >,
    extensionCard: { name: extensions.name, body: extensions.body, action: extensions.action },
    extensions: Object.fromEntries(
      extensionPages.map((extension) => [
        extension.slug,
        {
          name: extension.name,
          body: extension.body,
          title: extension.title,
          description: extension.description,
          intro: extension.intro,
          features: extension.features.map((feature) => ({ title: feature.title, body: feature.body })),
          install: extension.install.lead,
        },
      ]),
    ) as Record<
      ExtensionSlug,
      {
        name: string
        body: string
        title: string
        description: string
        intro: string
        features: { title: string; body: string }[]
        install: string
      }
    >,
    apps: Object.fromEntries(
      anomalyProducts.map((app) => [app.id, { category: app.category, body: app.body }]),
    ) as Record<(typeof anomalyProducts)[number]["id"], { category: string; body: string }>,
    // Pages read these with their own localized links (`localize`); the source uses plain paths.
    getStarted: getStarted((path) => path),
    byos,
    // Leaves that come from the dict are translated there (src/i18n/<locale>.ts), not here.
    brand: brandContent(t),
    press: pressContent(t, (path) => path),
    download: downloadContent(t, (path) => path),
    productDownloads: Object.fromEntries(
      allProductPages.map((product) => [product.slug, productDownloads(product.slug, (path) => path)]),
    ) as Record<PageSlug, ReturnType<typeof productDownloads>>,
    pair: pairContent(),
    // The home announcement, when Settings turns it on. Matched by its English text.
    announcements: announcements.map((item) => ({ text: item.text, link: item.link })),
  }
}

export const source = contentSource(translator("en"))

export type Content = typeof source

/** Fields that hold links, identifiers, logos, names of models and media, never copy. */
export const structural = [
  "href",
  "id",
  "slug",
  "logo",
  "icon",
  "wordmark",
  "metrics",
  "clip",
  "command",
  "plansHref",
  "freeModels",
  "amount",
  "providers",
  "file",
  "tone",
  "tones",
  "png",
  "svg",
  "variant",
  "kind",
  "email",
  "value",
  "size",
  "image",
  "video",
  "thumb",
  "color",
  "src",
  "poster",
] as const

/**
 * Fields that are ids when they hold a string, such as the FAQ's `copy: "home.faq.a3"` (its Design mode
 * copy id), and copy when they hold an object, such as the Brand page's `copy: { text, copied }`.
 */
export const structuralStrings = ["copy"] as const

/**
 * What a locale's file may set: any copy in `Content`, all optional. Lists match the English by
 * position, so a missing item or field shows the English. Structural fields can't be set.
 */
export type Overlay<T> = T extends string
  ? string
  : T extends readonly (infer Item)[]
    ? Item extends readonly unknown[]
      ? readonly (Overlay<Item> | undefined)[]
      : [Item] extends [object]
        ? { readonly [id: string]: Overlay<Item> | undefined }
        : readonly (Overlay<Item> | undefined)[]
    : T extends object
      ? {
          readonly [K in keyof T as K extends (typeof structural)[number]
            ? never
            : K extends (typeof structuralStrings)[number]
              ? T[K] extends string
                ? never
                : K
              : K]?: Overlay<T[K]>
        }
      : never

/**
 * Fields that hold an id under one parent only: a badge group's `label` (works-with) is part of the
 * badge file names. `*` stands for one path segment.
 */
export const structuralPaths = [
  "brand.integrations.badges.groups.*.label",
  // Link targets (a key named "links" elsewhere, such as press contact links, holds copy).
  "getStarted.links.*",
  "press.company.links.*",
  // Colour values (a key named "hex" elsewhere, such as the Hex app, is copy).
  "brand.colors.palettes.*.swatches.*.hex",
]

/** True for a list whose items are all objects: those match by `itemId`, not by position. */
export function keyedList(value: readonly unknown[]): value is readonly Record<string, unknown>[] {
  return value.length > 0 && value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
}

/**
 * The stable key of each item in a keyed list: its `id` or `slug`, otherwise its English title, name,
 * label, question, text, date or platform as a slug, numbered when two match. A reordered list keeps
 * every translation; an item whose English title changes shows as missing in i18n/check.ts.
 */
export function itemIds(items: readonly Record<string, unknown>[]) {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const named = ["id", "slug", "title", "name", "label", "question", "text", "date", "platform"]
      .map((key) => item[key])
      .find((value): value is string => typeof value === "string" && value.length > 0)
    const base =
      (named ?? "item")
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "item"
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  })
}

export type ContentOverlay = Overlay<Content>

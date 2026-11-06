// How page copy and its translations line up: which fields are never copy, and how list items are
// matched. Shared by the merge (content/index.ts), the source (content/source.ts) and the checks.

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

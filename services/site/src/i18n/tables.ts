import type { Locale } from "~/lib/language"
import type { Payload, Table } from "~/i18n"
import type { ContentOverlay } from "~/i18n/content/source"
import { dict as en } from "./en"

// Where the browser loads each language's strings from (i18n/index.ts). This is the development
// version, in which every slice is the whole language, read from its source files. A production
// client build replaces this module with the split files (script/i18n-plugin.ts).
export const tables: Record<Locale, () => Promise<Table>> = {
  en: () => whole(async () => ({ dict: en, content: {}, same: [] })),
  zh: () => language(import("./zh"), import("./content/zh")),
  zht: () => language(import("./zht"), import("./content/zht")),
  ko: () => language(import("./ko"), import("./content/ko")),
  de: () => language(import("./de"), import("./content/de")),
  es: () => language(import("./es"), import("./content/es")),
  fr: () => language(import("./fr"), import("./content/fr")),
  it: () => language(import("./it"), import("./content/it")),
  da: () => language(import("./da"), import("./content/da")),
  ja: () => language(import("./ja"), import("./content/ja")),
  pl: () => language(import("./pl"), import("./content/pl")),
  ru: () => language(import("./ru"), import("./content/ru")),
  uk: () => language(import("./uk"), import("./content/uk")),
  ar: () => language(import("./ar"), import("./content/ar")),
  no: () => language(import("./no"), import("./content/no")),
  br: () => language(import("./br"), import("./content/br")),
  th: () => language(import("./th"), import("./content/th")),
  tr: () => language(import("./tr"), import("./content/tr")),
}

/** A language's payload from its two source files: the dictionary over the English, and its page copy. */
export function payload(dict: Partial<Record<keyof typeof en, string>>, content: ContentOverlay): Payload {
  const keys = Object.keys(en) as (keyof typeof en)[]
  return {
    dict: { ...en, ...dict },
    content: content as Record<string, unknown>,
    same: keys.filter((key) => (dict[key] ?? en[key]) === en[key]),
  }
}

function language(dict: Promise<{ dict: Partial<Record<keyof typeof en, string>> }>, content: Promise<{ content: ContentOverlay }>) {
  return whole(() => Promise.all([dict, content]).then(([file, copy]) => payload(file.dict, copy.content)))
}

function whole(load: () => Promise<Payload>): Promise<Table> {
  return Promise.resolve({ all: () => load().then((value) => ({ default: value })) })
}

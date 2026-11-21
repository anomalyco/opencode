// TUI string translation. English is the source locale; other locales will
// override subsets of the keys and fall back to English for the rest.
//
// Lookups are synchronous so non-component modules can translate too.
import { dict as en, type Key } from "./en"

export type Locale = "en"

const dictionaries: Record<Locale, Partial<Record<Key, string>>> = { en }

const locale: Locale = "en"

// Placeholder names a template uses, so a call site must pass exactly the
// params its copy names and can not pass others.
type Placeholder<Text extends string> = Text extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never

type CallParams<K extends Key> =
  Placeholder<(typeof en)[K]> extends never ? [] : [params: Record<Placeholder<(typeof en)[K]>, string | number>]

export function t<K extends Key>(key: K, ...rest: CallParams<K>): string {
  const template = dictionaries[locale][key] ?? en[key]
  const params = rest[0] as Record<string, string | number> | undefined
  if (!params) return template
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey: string) => String(params[rawKey] ?? ""))
}

export * as I18n from "./index"

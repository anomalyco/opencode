import path from "node:path"

export const locale = [
  "ar",
  "bs",
  "da",
  "de",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "nb",
  "pl",
  "pt-br",
  "ru",
  "th",
  "tr",
  "zh-cn",
  "zh-tw",
] as const

export type Locale = (typeof locale)[number]

const file: Record<Locale, string> = {
  ar: "ar",
  bs: "bs",
  da: "da",
  de: "de",
  es: "es",
  fr: "fr",
  it: "it",
  ja: "ja",
  ko: "ko",
  nb: "nb",
  pl: "pl",
  "pt-br": "pt-BR",
  ru: "ru",
  th: "th",
  tr: "tr",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
}

export const docsDir = path.resolve(import.meta.dir, "../src/content/docs")
export const i18nDir = path.resolve(import.meta.dir, "../src/content/i18n")

export function i18nFile(code: Locale) {
  return file[code]
}

export function selected() {
  const index = Bun.argv.indexOf("--locales")
  if (index === -1 || !Bun.argv[index + 1]) {
    return [...locale]
  }
  const target = Bun.argv[index + 1]
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is Locale => (locale as readonly string[]).includes(x))

  if (target.length > 0) {
    return target
  }

  console.error(`No valid locales in --locales=${Bun.argv[index + 1]}`)
  process.exit(1)
}

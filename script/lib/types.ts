export interface LocaleFile {
  path: string
  locale: string
  keys: Set<string>
  dict: Record<string, string>
}

export interface MissingKeyReport {
  locale: string
  path: string
  missing: string[]
  count: number
}

export interface SyncResult {
  locale: string
  path: string
  added: number
  skipped: number
  errors: string[]
}

export type Command = "check" | "fill"

export interface Options {
  command: Command
  locale?: string
  dryRun: boolean
  verbose: boolean
  source: string
  json: boolean
}

export const LOCALES = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "ar",
  "no",
  "br",
  "th",
  "bs",
  "tr",
] as const

export type LocaleCode = (typeof LOCALES)[number]
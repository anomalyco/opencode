import { dict as en } from "./en"
import { dict as zh } from "./zh"

type Dict = typeof en
type Key = keyof Dict

const dicts: Record<string, Dict> = { en, zh }

function detect(): string {
  const lang = process.env.OPENCODE_LANG || process.env.LANG || process.env.LANGUAGE || ""
  if (lang.startsWith("zh")) return "zh"
  return "en"
}

const locale = detect()
const current = dicts[locale] ?? en

export function t(key: Key): string {
  return current[key] ?? en[key] ?? key
}

export function tpl(key: Key, vars: Record<string, string>): string {
  let result = t(key)
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{{${k}}}`, v)
  }
  return result
}

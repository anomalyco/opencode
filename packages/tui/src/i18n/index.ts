import { createMemo } from "solid-js"
import { createSimpleContext } from "../context/helper"
import { dict as en } from "./en"
import { dict as tr } from "./tr"

export type Locale = "en" | "tr"

type Dict = typeof en

const dicts: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  tr,
}

function resolveTemplate(template: string, params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) return `{{${key}}}`
    return String(value)
  })
}

function detectLocale(): Locale {
  const lang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || ""
  const normalized = lang.toLowerCase()
  if (normalized.startsWith("tr")) return "tr"
  return "en"
}

export const { use: useI18n, provider: I18nProvider } = createSimpleContext({
  name: "I18n",
  init: (props: { locale?: Locale }) => {
    const initial = props.locale ?? detectLocale()
    const locale = createMemo(() => initial)
    const dict = createMemo(() => dicts[locale()] ?? dicts.en)

    function t(key: keyof Dict, params?: Record<string, string | number | boolean | undefined>): string {
      const template = dict()[key]
      if (template === undefined) return String(key)
      return resolveTemplate(template, params)
    }

    return {
      locale,
      t,
      dict,
    }
  },
})

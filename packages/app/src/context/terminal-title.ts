import { dict as ar } from "@/i18n/ar"
import { dict as br } from "@/i18n/br"
import { dict as bs } from "@/i18n/bs"
import { dict as da } from "@/i18n/da"
import { dict as de } from "@/i18n/de"
import { dict as en } from "@/i18n/en"
import { dict as es } from "@/i18n/es"
import { dict as fr } from "@/i18n/fr"
import { dict as ja } from "@/i18n/ja"
import { dict as ko } from "@/i18n/ko"
import { dict as no } from "@/i18n/no"
import { dict as pl } from "@/i18n/pl"
import { dict as ru } from "@/i18n/ru"
import { dict as th } from "@/i18n/th"
import { dict as tr } from "@/i18n/tr"
import { dict as zh } from "@/i18n/zh"
import { dict as zht } from "@/i18n/zht"

const numbered = Array.from(
  new Set([
    en["terminal.title.numbered"],
    ar["terminal.title.numbered"],
    br["terminal.title.numbered"],
    bs["terminal.title.numbered"],
    da["terminal.title.numbered"],
    de["terminal.title.numbered"],
    es["terminal.title.numbered"],
    fr["terminal.title.numbered"],
    ja["terminal.title.numbered"],
    ko["terminal.title.numbered"],
    no["terminal.title.numbered"],
    pl["terminal.title.numbered"],
    ru["terminal.title.numbered"],
    th["terminal.title.numbered"],
    tr["terminal.title.numbered"],
    zh["terminal.title.numbered"],
    zht["terminal.title.numbered"],
  ]),
)

export function defaultTitle(number: number) {
  return en["terminal.title.numbered"].replace("{{number}}", String(number))
}

export function isDefaultTitle(title: string, number: number) {
  return numbered.some((text) => title === text.replace("{{number}}", String(number)))
}

export function titleNumber(title: string, max: number) {
  return Array.from({ length: max }, (_, idx) => idx + 1).find((number) => isDefaultTitle(title, number))
}

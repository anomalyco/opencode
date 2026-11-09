// Every language for the server, which renders any of them on any request; the browser loads only what
// the page shows (i18n/index.ts). Imported by entry-server.tsx and middleware.ts, never by client code.
import { register } from "~/i18n"
import { payload } from "~/i18n/tables"
import { dict as en } from "~/i18n/en"
import { dict as zh } from "~/i18n/zh"
import { dict as zht } from "~/i18n/zht"
import { dict as ko } from "~/i18n/ko"
import { dict as de } from "~/i18n/de"
import { dict as es } from "~/i18n/es"
import { dict as fr } from "~/i18n/fr"
import { dict as it } from "~/i18n/it"
import { dict as da } from "~/i18n/da"
import { dict as ja } from "~/i18n/ja"
import { dict as pl } from "~/i18n/pl"
import { dict as ru } from "~/i18n/ru"
import { dict as uk } from "~/i18n/uk"
import { dict as ar } from "~/i18n/ar"
import { dict as no } from "~/i18n/no"
import { dict as br } from "~/i18n/br"
import { dict as th } from "~/i18n/th"
import { dict as tr } from "~/i18n/tr"
import { content as zhContent } from "~/i18n/content/zh"
import { content as zhtContent } from "~/i18n/content/zht"
import { content as koContent } from "~/i18n/content/ko"
import { content as deContent } from "~/i18n/content/de"
import { content as esContent } from "~/i18n/content/es"
import { content as frContent } from "~/i18n/content/fr"
import { content as itContent } from "~/i18n/content/it"
import { content as daContent } from "~/i18n/content/da"
import { content as jaContent } from "~/i18n/content/ja"
import { content as plContent } from "~/i18n/content/pl"
import { content as ruContent } from "~/i18n/content/ru"
import { content as ukContent } from "~/i18n/content/uk"
import { content as arContent } from "~/i18n/content/ar"
import { content as noContent } from "~/i18n/content/no"
import { content as brContent } from "~/i18n/content/br"
import { content as thContent } from "~/i18n/content/th"
import { content as trContent } from "~/i18n/content/tr"

register("en", { dict: en, content: {}, same: [] }, true)
const languages = {
  zh: [zh, zhContent],
  zht: [zht, zhtContent],
  ko: [ko, koContent],
  de: [de, deContent],
  es: [es, esContent],
  fr: [fr, frContent],
  it: [it, itContent],
  da: [da, daContent],
  ja: [ja, jaContent],
  pl: [pl, plContent],
  ru: [ru, ruContent],
  uk: [uk, ukContent],
  ar: [ar, arContent],
  no: [no, noContent],
  br: [br, brContent],
  th: [th, thContent],
  tr: [tr, trContent],
} as const
for (const [locale, [dict, content]] of Object.entries(languages))
  register(locale as keyof typeof languages, payload(dict, content), true)

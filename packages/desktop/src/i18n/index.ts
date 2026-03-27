import * as i18n from "@solid-primitives/i18n"
import { Store } from "@tauri-apps/plugin-store"

import { dict as desktopEn } from "./en"
import { dict as desktopZh } from "./zh"
import { dict as desktopZht } from "./zht"
import { dict as desktopKo } from "./ko"
import { dict as desktopDe } from "./de"
import { dict as desktopEs } from "./es"
import { dict as desktopFr } from "./fr"
import { dict as desktopDa } from "./da"
import { dict as desktopJa } from "./ja"
import { dict as desktopPl } from "./pl"
import { dict as desktopRu } from "./ru"
import { dict as desktopAr } from "./ar"
import { dict as desktopNo } from "./no"
import { dict as desktopBr } from "./br"
import { dict as desktopBs } from "./bs"

import { dict as appEn } from "../../../app/src/i18n/en"
import { dict as appZh } from "../../../app/src/i18n/zh"
import { dict as appZht } from "../../../app/src/i18n/zht"
import { dict as appKo } from "../../../app/src/i18n/ko"
import { dict as appDe } from "../../../app/src/i18n/de"
import { dict as appEs } from "../../../app/src/i18n/es"
import { dict as appFr } from "../../../app/src/i18n/fr"
import { dict as appDa } from "../../../app/src/i18n/da"
import { dict as appJa } from "../../../app/src/i18n/ja"
import { dict as appPl } from "../../../app/src/i18n/pl"
import { dict as appRu } from "../../../app/src/i18n/ru"
import { dict as appAr } from "../../../app/src/i18n/ar"
import { dict as appNo } from "../../../app/src/i18n/no"
import { dict as appBr } from "../../../app/src/i18n/br"
import { dict as appBs } from "../../../app/src/i18n/bs"

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "ar"
  | "no"
  | "br"
  | "bs"

type RawDictionary = typeof appEn & typeof desktopEn
type Dictionary = i18n.Flatten<RawDictionary>

const LOCALES: readonly Locale[] = [
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
  "bs",
  "ar",
  "no",
  "br",
]

const STARTUP = {
  en: {
    launch: "Opening OpenCode...",
    backend: "Starting local backend...",
    project: "Restoring your workspace...",
    session: "Restoring your session...",
    ready: "Almost there...",
    backend_step: "Local backend",
    project_step: "Workspace",
    session_step: "Session",
  },
  zh: {
    launch: "正在打开 OpenCode...",
    backend: "正在启动本地后端...",
    project: "正在恢复工作区...",
    session: "正在恢复会话...",
    ready: "即将就绪...",
    backend_step: "本地后端",
    project_step: "工作区",
    session_step: "会话",
  },
  zht: {
    launch: "正在開啟 OpenCode...",
    backend: "正在啟動本機後端...",
    project: "正在恢復工作區...",
    session: "正在恢復工作階段...",
    ready: "即將就緒...",
    backend_step: "本機後端",
    project_step: "工作區",
    session_step: "工作階段",
  },
  ko: {
    launch: "OpenCode 여는 중...",
    backend: "로컬 백엔드 시작 중...",
    project: "작업 공간 복원 중...",
    session: "세션 복원 중...",
    ready: "거의 완료됨...",
    backend_step: "로컬 백엔드",
    project_step: "작업 공간",
    session_step: "세션",
  },
  de: {
    launch: "OpenCode wird geoffnet...",
    backend: "Lokales Backend wird gestartet...",
    project: "Arbeitsbereich wird wiederhergestellt...",
    session: "Sitzung wird wiederhergestellt...",
    ready: "Fast fertig...",
    backend_step: "Lokales Backend",
    project_step: "Arbeitsbereich",
    session_step: "Sitzung",
  },
  es: {
    launch: "Abriendo OpenCode...",
    backend: "Iniciando backend local...",
    project: "Restaurando tu espacio de trabajo...",
    session: "Restaurando tu sesion...",
    ready: "Casi listo...",
    backend_step: "Backend local",
    project_step: "Espacio de trabajo",
    session_step: "Sesion",
  },
  fr: {
    launch: "Ouverture d'OpenCode...",
    backend: "Demarrage du backend local...",
    project: "Restauration de votre espace de travail...",
    session: "Restauration de votre session...",
    ready: "Presque pret...",
    backend_step: "Backend local",
    project_step: "Espace de travail",
    session_step: "Session",
  },
  da: {
    launch: "Abner OpenCode...",
    backend: "Starter lokal backend...",
    project: "Gendanner dit arbejdsomrade...",
    session: "Gendanner din session...",
    ready: "Naesten klar...",
    backend_step: "Lokal backend",
    project_step: "Arbejdsomrade",
    session_step: "Session",
  },
  ja: {
    launch: "OpenCode を開いています...",
    backend: "ローカルバックエンドを起動しています...",
    project: "ワークスペースを復元しています...",
    session: "セッションを復元しています...",
    ready: "まもなく準備完了です...",
    backend_step: "ローカルバックエンド",
    project_step: "ワークスペース",
    session_step: "セッション",
  },
  pl: {
    launch: "Otwieranie OpenCode...",
    backend: "Uruchamianie lokalnego backendu...",
    project: "Przywracanie obszaru roboczego...",
    session: "Przywracanie sesji...",
    ready: "Prawie gotowe...",
    backend_step: "Lokalny backend",
    project_step: "Obszar roboczy",
    session_step: "Sesja",
  },
  ru: {
    launch: "Открываем OpenCode...",
    backend: "Запускаем локальный бэкенд...",
    project: "Восстанавливаем рабочее пространство...",
    session: "Восстанавливаем сессию...",
    ready: "Почти готово...",
    backend_step: "Локальный бэкенд",
    project_step: "Рабочее пространство",
    session_step: "Сессия",
  },
  ar: {
    launch: "جارٍ فتح OpenCode...",
    backend: "جارٍ تشغيل الواجهة الخلفية المحلية...",
    project: "جارٍ استعادة مساحة العمل...",
    session: "جارٍ استعادة الجلسة...",
    ready: "أوشكنا على الانتهاء...",
    backend_step: "الخلفية المحلية",
    project_step: "مساحة العمل",
    session_step: "الجلسة",
  },
  no: {
    launch: "Apner OpenCode...",
    backend: "Starter lokal backend...",
    project: "Gjenoppretter arbeidsomradet ditt...",
    session: "Gjenoppretter okten din...",
    ready: "Nesten klar...",
    backend_step: "Lokal backend",
    project_step: "Arbeidsomrade",
    session_step: "Okt",
  },
  br: {
    launch: "Abrindo o OpenCode...",
    backend: "Iniciando backend local...",
    project: "Restaurando seu workspace...",
    session: "Restaurando sua sessao...",
    ready: "Quase pronto...",
    backend_step: "Backend local",
    project_step: "Workspace",
    session_step: "Sessao",
  },
  bs: {
    launch: "Otvaranje OpenCode-a...",
    backend: "Pokretanje lokalnog backend-a...",
    project: "Obnavljanje radnog prostora...",
    session: "Obnavljanje sesije...",
    ready: "Jos malo...",
    backend_step: "Lokalni backend",
    project_step: "Radni prostor",
    session_step: "Sesija",
  },
} satisfies Record<Locale, Record<string, string>>

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("en")) return "en"
    if (language.toLowerCase().startsWith("zh")) {
      if (language.toLowerCase().includes("hant")) return "zht"
      return "zh"
    }
    if (language.toLowerCase().startsWith("ko")) return "ko"
    if (language.toLowerCase().startsWith("de")) return "de"
    if (language.toLowerCase().startsWith("es")) return "es"
    if (language.toLowerCase().startsWith("fr")) return "fr"
    if (language.toLowerCase().startsWith("da")) return "da"
    if (language.toLowerCase().startsWith("ja")) return "ja"
    if (language.toLowerCase().startsWith("pl")) return "pl"
    if (language.toLowerCase().startsWith("ru")) return "ru"
    if (language.toLowerCase().startsWith("ar")) return "ar"
    if (
      language.toLowerCase().startsWith("no") ||
      language.toLowerCase().startsWith("nb") ||
      language.toLowerCase().startsWith("nn")
    )
      return "no"
    if (language.toLowerCase().startsWith("pt")) return "br"
    if (language.toLowerCase().startsWith("bs")) return "bs"
  }

  return "en"
}

function readLocalLocale() {
  if (typeof localStorage !== "object") return null
  try {
    return pickLocale(parseStored(localStorage.getItem("opencode.global.dat:language")))
  } catch {
    return null
  }
}

function parseLocale(value: unknown): Locale | null {
  if (!value) return null
  if (typeof value !== "string") return null
  if ((LOCALES as readonly string[]).includes(value)) return value as Locale
  return null
}

function parseRecord(value: unknown) {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseStored(value: unknown) {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function pickLocale(value: unknown): Locale | null {
  const direct = parseLocale(value)
  if (direct) return direct

  const record = parseRecord(value)
  if (!record) return null

  return parseLocale(record.locale)
}

const base = i18n.flatten({ ...appEn, ...desktopEn })

function build(locale: Locale): Dictionary {
  if (locale === "en") return base
  if (locale === "zh") return { ...base, ...i18n.flatten(appZh), ...i18n.flatten(desktopZh) }
  if (locale === "zht") return { ...base, ...i18n.flatten(appZht), ...i18n.flatten(desktopZht) }
  if (locale === "de") return { ...base, ...i18n.flatten(appDe), ...i18n.flatten(desktopDe) }
  if (locale === "es") return { ...base, ...i18n.flatten(appEs), ...i18n.flatten(desktopEs) }
  if (locale === "fr") return { ...base, ...i18n.flatten(appFr), ...i18n.flatten(desktopFr) }
  if (locale === "da") return { ...base, ...i18n.flatten(appDa), ...i18n.flatten(desktopDa) }
  if (locale === "ja") return { ...base, ...i18n.flatten(appJa), ...i18n.flatten(desktopJa) }
  if (locale === "pl") return { ...base, ...i18n.flatten(appPl), ...i18n.flatten(desktopPl) }
  if (locale === "ru") return { ...base, ...i18n.flatten(appRu), ...i18n.flatten(desktopRu) }
  if (locale === "ar") return { ...base, ...i18n.flatten(appAr), ...i18n.flatten(desktopAr) }
  if (locale === "no") return { ...base, ...i18n.flatten(appNo), ...i18n.flatten(desktopNo) }
  if (locale === "br") return { ...base, ...i18n.flatten(appBr), ...i18n.flatten(desktopBr) }
  if (locale === "bs") return { ...base, ...i18n.flatten(appBs), ...i18n.flatten(desktopBs) }
  return { ...base, ...i18n.flatten(appKo), ...i18n.flatten(desktopKo) }
}

const state = {
  locale: readLocalLocale() ?? detectLocale(),
  dict: base as Dictionary,
  init: undefined as Promise<Locale> | undefined,
}

state.dict = build(state.locale)

const translate = i18n.translator(() => state.dict, i18n.resolveTemplate)

export function t(key: keyof Dictionary, params?: Record<string, string | number>) {
  return translate(key, params)
}

export function startup() {
  return STARTUP[state.locale] ?? STARTUP.en
}

export function initI18n(): Promise<Locale> {
  const cached = state.init
  if (cached) return cached

  const promise = (async () => {
    const store = await Store.load("opencode.global.dat").catch(() => null)
    if (!store) return state.locale

    const raw = await store.get("language").catch(() => null)
    const value = parseStored(raw)
    const next = pickLocale(value) ?? state.locale

    state.locale = next
    state.dict = build(next)
    return next
  })().catch(() => state.locale)

  state.init = promise
  return promise
}

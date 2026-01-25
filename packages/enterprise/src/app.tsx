import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Font } from "@opencode-ai/ui/font"
import { MetaProvider } from "@solidjs/meta"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { I18nProvider, type UiI18nParams } from "@opencode-ai/ui/context"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { dict as uiZh } from "@opencode-ai/ui/i18n/zh"
import { createEffect, createMemo, Suspense, type ParentProps } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import "./app.css"
import { Favicon } from "@opencode-ai/ui/favicon"

function resolveTemplate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey)
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

function detectLocaleFromHeader(header: string | null | undefined) {
  if (!header) return
  for (const item of header.split(",")) {
    const value = item.trim().split(";")[0]?.toLowerCase()
    if (!value) continue
    if (value.startsWith("zh")) return "zh" as const
    if (value.startsWith("en")) return "en" as const
  }
}

function detectLocale() {
  const event = getRequestEvent()
  const header = event?.request.headers.get("accept-language")
  const headerLocale = detectLocaleFromHeader(header)
  if (headerLocale) return headerLocale

  if (typeof document === "object") {
    const value = document.documentElement.lang?.toLowerCase() ?? ""
    if (value.startsWith("zh")) return "zh" as const
    if (value.startsWith("en")) return "en" as const
  }

  if (typeof navigator === "object") {
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const language of languages) {
      if (!language) continue
      if (language.toLowerCase().startsWith("zh")) return "zh" as const
    }
  }

  return "en" as const
}

function UiI18nBridge(props: ParentProps) {
  const locale = createMemo(() => detectLocale())
  const t = (key: keyof typeof uiEn, params?: UiI18nParams) => {
    const value = locale() === "zh" ? (uiZh[key] ?? uiEn[key]) : uiEn[key]
    const text = value ?? String(key)
    return resolveTemplate(text, params)
  }

  createEffect(() => {
    if (typeof document !== "object") return
    document.documentElement.lang = locale()
  })

  return <I18nProvider value={{ locale, t }}>{props.children}</I18nProvider>
}

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <DialogProvider>
            <MarkedProvider>
              <Favicon />
              <Font />
              <UiI18nBridge>
                <Suspense>{props.children}</Suspense>
              </UiI18nBridge>
            </MarkedProvider>
          </DialogProvider>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}

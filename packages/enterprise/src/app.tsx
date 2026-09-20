import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Font } from "@opencode-ai/ui/font"
import { MetaProvider } from "@solidjs/meta"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { I18nProvider } from "@opencode-ai/ui/context"
import { pluralCategory, pluralKey, type UiI18nParams, type UiI18nPluralKey } from "@opencode-ai/ui/context/i18n"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { createEffect, createMemo, Suspense, type ParentProps } from "solid-js"
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

// English only, matching the rest of VeniceCode.
function detectLocale() {
  return "en" as const
}

function UiI18nBridge(props: ParentProps) {
  const locale = createMemo(() => detectLocale())
  const t = (key: keyof typeof uiEn, params?: UiI18nParams) => {
    const text = uiEn[key] ?? String(key)
    return resolveTemplate(text, params)
  }
  const plural = (key: UiI18nPluralKey, count: number, params?: UiI18nParams) =>
    t(pluralKey(key, pluralCategory(locale(), count)), { ...params, count })

  createEffect(() => {
    if (typeof document !== "object") return
    document.documentElement.lang = locale()
  })

  return <I18nProvider value={{ locale, t, plural }}>{props.children}</I18nProvider>
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

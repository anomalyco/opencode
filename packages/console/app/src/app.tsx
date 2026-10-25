import { MetaProvider, Title } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Favicon } from "@bolt-ai/ui/favicon"
import { Font } from "@bolt-ai/ui/font"
import "@ibm/plex/css/ibm-plex.css"
import "./app.css"
import { LanguageProvider } from "~/context/language"
import { I18nProvider } from "~/context/i18n"
import { strip } from "~/lib/language"

function AppMeta() {
  return (
    <>
      <Title>Bolt Cli</Title>
      <Meta name="description" content={i18n.t("app.meta.description")} />
      <Favicon />
      <Font />
    </>
  )
}

export default function App() {
  return (
    <Router
      explicitLinks={true}
      transformUrl={strip}
      root={(props) => (
        <LanguageProvider>
          <I18nProvider>
            <MetaProvider>
              <AppMeta />
              <Suspense>{props.children}</Suspense>
            </MetaProvider>
          </I18nProvider>
        </LanguageProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}

import { MetaProvider, Title, Meta } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Favicon } from "@weapon-ai/ui/favicon"
import { Font } from "@weapon-ai/ui/font"
import "@ibm/plex/css/ibm-plex.css"
import "./app.css"
import { LanguageProvider } from "~/context/language"
import { I18nProvider } from "~/context/i18n"
import { strip } from "~/lib/language"

export default function App() {
  return (
    <Router
      explicitLinks={true}
      transformUrl={strip}
      root={(props) => (
        <LanguageProvider>
          <I18nProvider>
            <MetaProvider>
              <Title>weapon</Title>
              <Meta name="description" content="Weapon - The open source coding agent." />
              <Favicon />
              <Font />
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

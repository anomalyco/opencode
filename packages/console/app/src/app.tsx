import { MetaProvider, Title } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Favicon } from "@opencode/ui/favicon"
import { Font } from "@opencode/ui/font"
// Only IBM Plex Mono is used. The full ibm-plex.css declares 424 faces across every Plex family.
import "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Regular.css"
import "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Text.css"
import "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Medium.css"
import "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-SemiBold.css"
import "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Bold.css"
import "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Italic.css"
import "./app.css"
import { LanguageProvider } from "~/context/language"
import { I18nProvider } from "~/context/i18n"
import { strip } from "~/lib/language"

function AppMeta() {
  return (
    <>
      <Title>opencode</Title>
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

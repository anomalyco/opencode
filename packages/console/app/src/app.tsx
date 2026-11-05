import { Link, Title, Meta } from "@solidjs/meta"
import { Router, useCurrentMatches, useLocation } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Show, Suspense } from "solid-js"
import { Favicon } from "@opencode/ui/favicon"
import { Font } from "@opencode/ui/font"
import "./style/ibm-plex-mono.css"
import "./app.css"
import { LanguageProvider } from "~/context/language"
import { I18nProvider, useI18n } from "~/context/i18n"
import { config } from "~/config"
import { ogImage } from "~/lib/og"
import { strip } from "~/lib/language"
import { HeadMetaProvider, LiveMeta } from "~/component/head-meta"
import { viewportContent } from "~/lib/viewport"
// Before the router, so its popstate listener comes first.
import "~/component/site/popstate"
import { monoFontFaces } from "~/component/site/mono-fonts"

// Pages that set their own og:image.
const shareImagePages = [
  "/",
  "/desktop",
  "/mobile",
  "/terminal",
  "/sdk",
  "/ide",
  "/mini",
  "/extensions/browse",
  "/product",
  "/docs",
  "/changelog",
  "/brand",
  "/font",
  "/press",
  "/zen",
]
const ownShareImage = (path: string) =>
  shareImagePages.includes(path) || path.startsWith("/legal") || path.startsWith("/changelog/")
// Pages that set their own description.
const ownDescription = (path: string) => ownShareImage(path) && path !== "/zen"

function AppMeta() {
  const i18n = useI18n()
  const location = useLocation()
  const matches = useCurrentMatches()
  // The 404 route and its /dev/404 previews (the dev server shows one for bad URLs).
  const notFound = () => matches().some((match) => match.route.pattern.includes("404"))
  return (
    <>
      <Title>opencode</Title>
      <LiveMeta name="viewport" content={viewportContent()} />
      {/* Defaults, skipped on pages that set their own: the server renders both tags, which would compete. */}
      <Show when={!ownDescription(strip(location.pathname))}>
        <Meta name="description" content={i18n.t("app.meta.description")} />
      </Show>
      {/* The 404 page sets its own card (component/site/arcade3d/not-found-page.tsx), whatever the URL. */}
      <Show when={!ownShareImage(strip(location.pathname)) && !notFound()}>
        <Meta property="og:image" content={`${config.baseUrl}${ogImage("/").src}`} />
        <Meta name="twitter:image" content={`${config.baseUrl}${ogImage("/").src}`} />
      </Show>
      {/* The Markdown map of the site, for agents (https://llmstxt.org). */}
      <Link rel="describedby" type="text/plain" href={`${config.baseUrl}/llms.txt`} />
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
      // The router restores scroll on back and forward itself, once the page has rendered. The
      // browser's own restore lands before that, on the page being left, and shows as a jump at
      // the start of the hero's shrink back into its card.
      scrollRestoration
      root={(props) => (
        <LanguageProvider>
          <I18nProvider>
            <HeadMetaProvider>
              <AppMeta />
              {/* OpenTUI Mono for every page, with or without the site shell (--font-mono and the
                  token stack name it). A plain style element, which hydration keeps. */}
              <style innerHTML={monoFontFaces} />
              <Suspense>{props.children}</Suspense>
            </HeadMetaProvider>
          </I18nProvider>
        </LanguageProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}

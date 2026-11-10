import { Link, Title, Meta } from "@solidjs/meta"
import { Router, useBeforeLeave, useCurrentMatches, useIsRouting, useLocation } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { createEffect, type JSX, Show, Suspense } from "solid-js"
import { isServer } from "solid-js/web"
import { Favicon } from "@opencode/ui/favicon"
import { Font } from "@opencode/ui/font"
import "./style/ibm-plex-mono.dev.css"
import "./style/fonts.css"
import "./app.css"
import { LanguageProvider } from "~/context/language"
import { I18nProvider, useI18n } from "~/context/i18n"
import { preloadStrings } from "~/i18n/preload"
import { config } from "~/config"
import { ogImage } from "~/lib/og"
import { strip } from "~/lib/language"
import { HeadMetaProvider, LiveMeta } from "~/component/head-meta"
import { viewportContent } from "~/lib/viewport"
import { quietPreloads, setNavigating } from "~/lib/route-preloads"
// Before the router, so its popstate listener comes first.
import "~/component/site/popstate"

// Pages that set their own og:image.
const shareImagePages = [
  "/",
  "/desktop",
  "/terminal",
  "/mobile",
  "/sdk",
  "/ide",
  "/mini",
  "/product/browse",
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
  preloadStrings()
  // Preloaded pages' stylesheets wait for a navigation (lib/route-preloads.ts).
  if (!isServer) {
    const routing = useIsRouting()
    // A leave that another listener blocked, or that stays on this page, never starts routing.
    useBeforeLeave(() => {
      setNavigating(true)
      queueMicrotask(() => routing() || setNavigating(false))
    })
    createEffect(() => setNavigating(routing()))
  }
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

// The router's scroll restoration (below) sets history.scrollRestoration to "manual" and restores
// only after the app has loaded, so a page loaded again (a reload, or back from another site or a
// plain link) would paint at the top and then jump. Leaving a document hands its entry back to the
// browser, which restores it as the page loads; a page restored from the back/forward cache, still
// running, takes the router's manual mode again for its in-site back and forward.
if (!isServer) {
  window.addEventListener("pagehide", () => (history.scrollRestoration = "auto"))
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) history.scrollRestoration = "manual"
  })
}

// The file routes, with preloads that leave the page alone when they fail (lib/route-preloads.ts). A
// component on both sides, as <FileRoutes /> was, so hydration counts it the same.
const Routes = () => (isServer ? FileRoutes() : quietPreloads(FileRoutes()))

export default function App() {
  return (
    <Router
      explicitLinks={true}
      transformUrl={strip}
      // On in-site back and forward the router restores scroll itself, once the page has rendered.
      // The browser's own restore lands right after popstate, on the page being left, and shows as
      // a jump at the start of the hero's shrink back into its card.
      scrollRestoration
      root={AppRoot}
    >
      <Routes />
    </Router>
  )
}

/** Every page's providers and default head tags, here and on the static pages (src/static/render.tsx). */
export function AppRoot(props: { children?: JSX.Element }) {
  return (
    <LanguageProvider>
      <I18nProvider>
        <HeadMetaProvider>
          <AppMeta />
          <Suspense>{props.children}</Suspense>
        </HeadMetaProvider>
      </I18nProvider>
    </LanguageProvider>
  )
}

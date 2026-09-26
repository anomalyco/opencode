// @refresh reload
import type { Asset, PageEvent } from "@solidjs/start"
import { createHandler, StartServer } from "@solidjs/start/server"
import ibmPlexMonoMediumLatin1 from "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Medium-Latin1.woff2?url"
import { getRequestEvent } from "solid-js/web"
import { dir, localeFromRequest, tag } from "./lib/language"
import statsStylesheetUrl from "./routes/index.css?url"

const statsThemePreloadScript = `;(function () {
  var preference = "system"
  try {
    var stored = localStorage.getItem("opencode:stats-theme")
    if (stored === "dark" || stored === "light" || stored === "system") preference = stored
  } catch (_) {}
  document.documentElement.dataset.statsTheme = preference
  if (preference === "system") document.documentElement.style.removeProperty("color-scheme")
  else document.documentElement.style.setProperty("color-scheme", preference)
})()`

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => {
        const event = getRequestEvent() as PageEvent | undefined
        const locale = event ? localeFromRequest(event.request) : "en"
        const stylesheet = (event?.assets as Asset[] | undefined)?.find(
          (asset): asset is Extract<Asset, { tag: "link" }> => asset.tag === "link" && asset.attrs.rel === "stylesheet",
        )
        const stylesheetHref = import.meta.env.DEV ? statsStylesheetUrl : stylesheet?.attrs.href

        return (
          <html lang={tag(locale)} dir={dir(locale)} data-locale={locale}>
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <script id="stats-theme-preload-script">{statsThemePreloadScript}</script>
              <link rel="preload" href={ibmPlexMonoMediumLatin1} as="font" type="font/woff2" crossorigin="anonymous" />
              {stylesheetHref ? <link rel="stylesheet" href={stylesheetHref} /> : null}
              {assets}
            </head>
            <body>
              <div id="app">{children}</div>
              {scripts}
            </body>
          </html>
        )
      }}
    />
  ),
  {
    mode: "async",
  },
)

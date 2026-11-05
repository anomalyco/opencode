// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"
import { getRequestEvent, ssr } from "solid-js/web"
import { dir, pageLocale, tag } from "~/lib/language"
import { sourceLogo } from "~/lib/source-logo"
import { freezeScript } from "~/lib/freeze"
// Every language, before any page renders.
import "~/i18n/server"

const criticalCSS = `[data-component="top"]{min-height:80px;display:flex;align-items:center}`

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => {
        const evt = getRequestEvent()
        // The language comes from the URL only (dev #56564), never the cookie, so / is always English.
        const locale = evt ? pageLocale(evt.request) : "en"

        return (
          <html lang={tag(locale)} dir={dir(locale)} data-locale={locale}>
            <head>
              <meta charset="utf-8" />
              {/* After the charset meta: the art is over 1 KB, and the meta must come in the first 1024 bytes. */}
              {ssr([`\n${sourceLogo}\n`]) as unknown as Element}
              <style>{criticalCSS}</style>
              {/* Development only, before Vite's client loads: the device preview's Freeze (lib/freeze.ts). */}
              {import.meta.env.DEV && <script innerHTML={freezeScript} />}
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

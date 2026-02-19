// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"
import { getRequestEvent } from "solid-js/web"

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => {
      const lang = (() => {
        const event = getRequestEvent()
        const header = event?.request.headers.get("accept-language")
        if (!header) return "en"
        for (const item of header.split(",")) {
          const value = item.trim().split(";")[0]?.toLowerCase()
          if (!value) continue
          if (value.startsWith("zh")) return "zh"
          if (value.startsWith("en")) return "en"
        }
        return "en"
      })()

      return (
        <html lang={lang}>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>OpenCode</title>
            <meta name="theme-color" content="#F8F7F7" />
            <meta name="theme-color" content="#131010" media="(prefers-color-scheme: dark)" />
            {assets}
          </head>
          <body class="antialiased overscroll-none text-12-regular">
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )
    }}
  />
))

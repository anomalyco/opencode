// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta property="og:image" content="/social-share.png" />
            <meta property="twitter:image" content="/social-share.png" />
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  {
    mode: "async",
  },
)

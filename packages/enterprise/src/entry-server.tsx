// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>OpenCode</title>
          <meta name="theme-color" content="#F8F7F7" />
          <meta name="theme-color" content="#131010" media="(prefers-color-scheme: dark)" />
          <meta property="og:image" content="/social-share.png" />
          <meta property="twitter:image" content="/social-share.png" />
          {assets}
        </head>
        <body class="antialiased overscroll-none select-none text-12-regular">
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
))

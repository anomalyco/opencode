// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          <title>OpenCode</title>
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

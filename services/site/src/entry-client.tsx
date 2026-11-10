// @refresh reload
import { mount, StartClient } from "@solidjs/start/client"
import { loadSlice } from "~/i18n/content"
import { Funnel } from "~/lib/funnel"

// Every page, the not-found page too, reports to the Console's funnel from its markup (lib/funnel.ts).
Funnel.start(() => import("~/lib/funnel-config").then((module) => module.funnelConfig()))

// The development server's app: production hydrates no page (src/static/render.tsx), and its pages
// load the static pages' script instead (src/client/entry.ts). The strings every page shows load
// before hydration, so the first client render matches the server's.
void loadSlice("shell")
  .catch(() => undefined)
  .then(() => mount(() => <StartClient />, document.getElementById("app")!))

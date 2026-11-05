// @refresh reload
import { mount, StartClient } from "@solidjs/start/client"
import { loadSlice } from "~/i18n/content"

// The strings every page shows arrive before hydration (the server preloads them, i18n/preload.ts),
// so the first client render matches the server's. Each page route loads its own before it runs.
void loadSlice("shell")
  .catch(() => undefined)
  .then(() => mount(() => <StartClient />, document.getElementById("app")!))

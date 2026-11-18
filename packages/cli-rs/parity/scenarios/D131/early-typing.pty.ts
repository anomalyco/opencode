// D131: keys typed at once on start, while the model list is still loading (the server answers it after 4 s), reach
// the prompt without waiting for it. The Windows run saw typing stall for 20 s and 28 s before the model showed.
import { definePty } from "../../pty/run"
import { catalog } from "../C.13/catalog"

const config = JSON.stringify({ experimental: { "new-designs": true }, animations: false, debug: { devtools: false } })

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: {
    fallback: "tui",
    routes: catalog.map((route) => (route.path === "/api/model" ? { ...route, delay: 4000 } : route)),
  },
  steps: [
    { until: { screen: "█▀▀█" }, timeout: 30_000 },
    // Well inside the model list's delay, with no settle: the keys show while it loads.
    { keys: "typed early", until: { screen: "typed early" }, timeout: 1500, absent: "Demo Model" },
    { until: { screen: "Demo Model" }, settle: 300, checkpoint: "loaded", timeout: 10_000 },
    { keys: "\x15", until: { gone: "typed early" }, settle: 300 },
    // Ctrl+C on the empty prompt exits; a second press could land once the terminal is restored, as a SIGINT.
    { keys: "\x03", until: { exit: true } },
  ],
  exits: true,
})

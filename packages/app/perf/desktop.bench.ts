// The packaged desktop app, launched by strobe in a private home from the `opencode` profiles in strobe.json.
// Compare two installed channels: `strobe bench packages/app/perf/desktop.bench.ts --base app:opencode --head app:opencode-beta`.
import { app, bench } from "@strobe/bench"

export default bench({
  targets: {
    desktop: app("opencode", { viewport: { width: 1366, height: 768 } }),
  },

  async setup({ page }) {
    await page.waitFor('[data-component="composer-editor"]', { timeout: 60_000 })
    await page.idle()
  },

  cases: {
    // Every process of the app (window, GPU, the background service) while nothing happens: what an open app costs.
    idle: {
      primary: "cpu.app.total",
      run: ({ page }) => page.wait(5_000),
    },
  },
})

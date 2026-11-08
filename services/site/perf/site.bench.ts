// Main-thread work on the site's pages and interactions, for strobe (https://github.com/Hona/strobe).
// Each variant is the production build (script/build.ts) served in workerd by perf/serve.ts.
//
//   strobe bench services/site/perf/site.bench.ts --base origin/dev --head . --headless
//
// Loads are returning visits: each run navigates from about:blank with the HTTP cache warm, so they
// measure parsing, running and hydrating the page's code, not the network. Interactions start from a
// fresh load of the home page, so each run is the first ⌘K, hover or click after a load.
import { bench, url, web, type Context, type RunCase } from "@hona/strobe"

const desktop = { width: 1440, height: 900 }
const card = '[data-component="products"][data-layout="carousel"] [data-component="product-card"] [data-slot="media"]'

// Absolute: page.goto resolves a relative path against about:blank after the reset.
const load = (path: string): RunCase<unknown> => ({
  primary: "main.work",
  run: async (ctx) => {
    await ctx.page.goto(new URL(path, ctx.url).href)
    await ctx.page.idle()
  },
  reset: (ctx) => ctx.page.goto("about:blank"),
})

// Each target's input: a desktop has a mouse, a phone a touch screen, and the site takes different
// paths for each (preloading links as they scroll into view, autoplaying card videos). strobe refuses
// a page that doesn't see its target's input (DeviceMismatch). On the phone a scroll is a finger's
// swipes and a click a tap; a phone has no hover, so card-hover and search (⌘K) stay on the desktop.
const reload = async (ctx: Context<unknown>) => {
  await ctx.page.goto(new URL("/", ctx.url).href)
  await ctx.page.idle()
}

export default bench({
  targets: {
    desktop: web({ url: "/", viewport: desktop }),
    phone: web({ url: "/", emulate: "mobile" }),
    // The live site, for reference only: `--target production --blocks 5 --head .` (nothing to build).
    production: url("https://opencode.ai/", { viewport: desktop }),
  },
  setup: ({ page }) => page.idle(),
  cases: {
    "load-home": load("/"),
    "load-product": { ...load("/product"), targets: ["desktop", "production"] },
    "load-desktop": { ...load("/desktop"), targets: ["desktop", "production"] },
    "load-docs": { ...load("/docs/"), targets: ["desktop", "production"] },
    "scroll-home": {
      primary: "main.work",
      targets: ["desktop", "phone", "production"],
      run: ({ page }) => page.scroll("main", { by: 12000, speed: 6000 }),
      reset: reload,
    },
    search: {
      primary: "main.work",
      targets: ["desktop", "production"],
      run: async ({ page }) => {
        await page.press("ControlOrMeta+k", { until: '[data-component="site-search"] [role="dialog"]' })
        await page.idle()
      },
      reset: reload,
    },
    "card-hover": {
      primary: "main.work",
      targets: ["desktop", "production"],
      run: async ({ page }) => {
        await page.hover(card)
        await page.idle()
      },
      reset: async (ctx) => {
        await ctx.page.move(1, 1)
        await reload(ctx)
      },
    },
    "card-open": {
      primary: "main.work",
      targets: ["desktop", "phone", "production"],
      run: async ({ page }) => {
        await page.click(card, { until: '[data-component="product-hero"]' })
        await page.idle()
      },
      reset: reload,
    },
  },
})

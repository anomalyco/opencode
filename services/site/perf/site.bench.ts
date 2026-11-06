// Main-thread work on the site's pages and interactions, for strobe (https://github.com/Hona/strobe).
// Each variant is the production build (script/build.ts) served in workerd by perf/serve.ts.
//
//   strobe bench services/site/perf/site.bench.ts --base origin/dev --head . --headless
//
// Loads are returning visits: each run navigates from about:blank with the HTTP cache warm, so they
// measure parsing, running and hydrating the page's code, not the network. Interactions start from a
// fresh load of the home page, so each run is the first ⌘K, hover or click after a load.
import { bench, url, web, type Context, type PrepareContext, type RunCase } from "@hona/strobe"

const desktop = { width: 1440, height: 900 }
const phone = { width: 390, height: 844 }
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
// paths for each (preloading links as they scroll into view, autoplaying card videos). Headless
// Chromium as strobe 0.14 launches it has neither and matches (hover: none), so until strobe gives it
// a mouse, point STROBE_BROWSER at a wrapper that runs Chrome with
// --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4.
// The phone target turns touch emulation on, and setup refuses a page with the wrong input.
const touch = async (ctx: PrepareContext<unknown>) => {
  const session = await ctx.playwright.context.newCDPSession(ctx.playwright.page)
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
}

const reload = async (ctx: Context<unknown>) => {
  await ctx.page.goto(new URL("/", ctx.url).href)
  await ctx.page.idle()
}

export default bench({
  targets: {
    desktop: web({ url: "/", viewport: desktop }),
    phone: web({ url: "/", viewport: phone, scale: 3, prepare: touch }),
    // The live site, for reference only: `--target production --blocks 5 --head .` (nothing to build).
    production: url("https://opencode.ai/", { viewport: desktop }),
  },
  async setup({ page, target }) {
    const mouse = await page.eval(() => matchMedia("(hover: hover) and (pointer: fine)").matches)
    if (mouse !== (target !== "phone"))
      throw new Error(`the ${target} page ${mouse ? "has" : "lacks"} a mouse; see the input note in site.bench.ts`)
    await page.idle()
  },
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
      run: async ({ page }) => {
        await page.click(card, { until: '[data-component="product-hero"]' })
        await page.idle()
      },
      reset: reload,
    },
  },
})

import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import { fromPathname } from "./src/lib/language"
import { docs } from "./src/docs/vite"
import { i18nSlices } from "./script/i18n-plugin"
import { foldSettingsForProduction } from "./script/fold-settings"
import { cssVariantsForProduction, devOnlyCss } from "./script/css-variants-plugin"

// Nitro's dev server drops any page the app renders with a 404 status and falls through to a bare
// "Cannot GET". In development only, serve the not-found page's preview (/dev/404, which follows
// Settings › 404 arcade › Mode like the real route) with a 404 status instead, so bad URLs look and
// hydrate as they do in production.
function notFoundInDev(): PluginOption {
  return {
    name: "not-found-in-dev",
    apply: "serve",
    configureServer(server) {
      return () =>
        server.middlewares.use(async (req, res, next) => {
          const page =
            req.method === "GET" && !req.url?.startsWith("/dev/404") && req.headers.accept?.includes("text/html")
          if (!page) return next()
          // The preview renders in the address's language (its /<locale> prefix, else the visitor's
          // cookie or Accept-Language), with that language's lang and dir, as the real route does.
          const locale = fromPathname(req.url ?? "/")
          const response = await fetch(`http://${req.headers.host}${locale ? `/${locale}` : ""}/dev/404`, {
            headers: {
              cookie: req.headers.cookie ?? "",
              "accept-language": req.headers["accept-language"] ?? "",
            },
          }).catch(() => undefined)
          if (!response?.ok) return next()
          res.statusCode = 404
          res.setHeader("content-type", "text/html; charset=utf-8")
          res.end(await response.text())
        })
    },
  }
}

export default defineConfig({
  plugins: [
    // Before Solid compiles JSX, in both the server and browser builds (script/fold-settings.ts).
    foldSettingsForProduction(),
    solidStart({
      middleware: "./src/middleware.ts",
    }) as PluginOption,
    nitro({
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }),
    notFoundInDev(),
    devOnlyCss(),
    cssVariantsForProduction(),
    docs(),
    i18nSlices(),
  ],
  server: {
    allowedHosts: true,
    port: 3001,
    proxy: {
      // Development only: the 404 arcade loads anoma.ly/arcade games under our own origin, so its
      // touch panel can send synthetic input into the same-origin frame. Production needs the
      // arcade's input bridge instead (see component/site/arcade/games.ts).
      "/arcade-proxy": {
        target: "https://anoma.ly",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/arcade-proxy/, "/arcade"),
      },
      // Development only: heavy media is in the files bucket (src/lib/media.ts), so play the dev copies.
      "/files": {
        target: "https://dev.opencode.ai",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
    minify: false,
    // The stylesheets the pages load are minified even though the Worker's code is not.
    cssMinify: true,
    // Browsers with native light-dark() (and CSS nesting). For older targets the minifier lowers
    // light-dark() to --lightningcss-light/--lightningcss-dark variables set only where a rule
    // declares color-scheme, so the site's tokens freeze at the theme of the element that defines
    // them: a forced-dark card or band (color-scheme: dark) kept the page's light tokens in
    // production, though the dev server (no lowering) showed it right.
    cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"],
  },
  environments: {
    // The browser bundles are minified; the Worker keeps readable code for its stack traces.
    client: {
      build: {
        // Nitro copies public/ with fs.cp, which keeps the symlinks into packages/ui as links.
        // Letting Vite copy it first writes real files.
        copyPublicDir: true,
        // Oxc, Vite 8's own minifier. "esbuild" here left the bundles unminified: Vite only adds its
        // esbuild minifier when the top-level build.minify asks for it, and that stays off for the Worker.
        minify: "oxc",
        // strobe builds with STROBE_SOURCEMAP=hidden: maps beside the scripts without a
        // sourceMappingURL comment, so the scripts stay byte for byte and profiles name source lines.
        sourcemap: process.env.STROBE_SOURCEMAP === "hidden" ? "hidden" : undefined,
        rolldownOptions: {
          output: {
            // Rolldown gives the code that pages share one chunk per set of pages sharing it, which
            // had the home page preload 29 files, most under 3 kB. Plain modules (not components,
            // which may bring their stylesheet to every page that loads the chunk) of up to 4 kB
            // that 12 or more of the bundle's entries (page routes and lazily loaded modules)
            // import go in one chunk instead: fewer requests and a little less code on most pages.
            // Each language's strings keep their own files (script/i18n-plugin.ts).
            codeSplitting: {
              groups: [
                {
                  name: "common",
                  test: (id) => !/\.(tsx|jsx|css)(\?|$)/.test(id) && !id.startsWith("\0virtual:i18n"),
                  minShareCount: 12,
                  maxModuleSize: 4000,
                },
              ],
            },
          },
        },
      },
    },
  },
})

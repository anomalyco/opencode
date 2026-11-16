import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import { fromPathname } from "./src/lib/language"
import { docs } from "./src/docs/vite"
import { foldSettingsForProduction } from "./script/fold-settings"
import { cssVariantsForProduction, devOnlyCss } from "./script/css-variants-plugin"
import { stylesheetGroups } from "./script/stylesheet-groups"
import { staticClient } from "./script/static-client"

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
      // The Worker's code in one file. Nitro bundles the server build's chunks again, and Rolldown
      // could split code the pages share with the server entry into a chunk that imports the entry
      // back, which workerd refuses to load (5 Nov: _ssr/ssr.mjs and ssr2.mjs, "Export 'ssr_exports'
      // is not defined"). Every module ships in the one upload anyway, so splitting saves nothing.
      // Here, not as Nitro's top-level inlineDynamicImports: the preset's rollupConfig overrides that.
      rollupConfig: { output: { inlineDynamicImports: true } },
    }),
    notFoundInDev(),
    devOnlyCss(),
    cssVariantsForProduction(),
    stylesheetGroups(),
    staticClient(),
    docs(),
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
    client: {
      build: {
        // Nitro copies public/ with fs.cp, which keeps the symlinks into packages/ui as links.
        // Letting Vite copy it first writes real files.
        copyPublicDir: true,
      },
    },
  },
})

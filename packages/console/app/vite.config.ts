import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import { fromPathname } from "./src/lib/language"
import variants from "./src/component/site/css-variants.json"

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

// Production only: Settings and Design mode are development tools, so the site root's settings
// attributes always carry the default settings' values (src/component/site/css-variants.json). This
// drops, from the production CSS, each selector that needs another value of one of them, and each
// rule left with none; the development server keeps every variant for Design mode. Only attributes
// outside parentheses count (an attribute inside :not(), :is() or :has() keeps its selector).
function cssVariantsForProduction(): PluginOption {
  const fixed = variants as Record<string, string | null>
  const impossible = (selector: string) => {
    let depth = 0
    let top = ""
    for (const char of selector) {
      if (char === "(") depth++
      if (depth === 0) top += char
      if (char === ")") depth--
    }
    return [...top.matchAll(/\[(data-[\w-]+)(~?=)["']?([^"'\]]*)["']?\]/g)].some((match) => {
      if (!(match[1] in fixed)) return false
      const value = fixed[match[1]]
      if (value === null) return true
      return match[2] === "~=" ? !value.split(" ").includes(match[3]) : value !== match[3]
    })
  }
  const split = (selector: string) => {
    const parts: string[] = []
    let depth = 0
    let quote = ""
    let start = 0
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i]
      if (quote) {
        if (char === quote) quote = ""
        continue
      }
      if (char === '"' || char === "'") quote = char
      else if (char === "(" || char === "[") depth++
      else if (char === ")" || char === "]") depth--
      else if (char === "," && depth === 0) {
        parts.push(selector.slice(start, i))
        start = i + 1
      }
    }
    return [...parts, selector.slice(start)]
  }
  return {
    name: "css-variants-for-production",
    apply: "build",
    config: () => ({
      css: {
        postcss: {
          plugins: [
            {
              postcssPlugin: "css-variants-for-production",
              Rule(rule: { selector: string; remove(): void }) {
                const selectors = split(rule.selector)
                const kept = selectors.filter((selector) => !impossible(selector))
                if (kept.length === selectors.length) return
                if (!kept.length) return rule.remove()
                rule.selector = kept.join(",")
              },
            },
          ],
        },
      },
    }),
  }
}

export default defineConfig({
  plugins: [
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
    cssVariantsForProduction(),
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
    },
  },
  build: {
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
    minify: false,
    // The stylesheets the pages load are minified even though the Worker's code is not.
    cssMinify: true,
  },
  environments: {
    // The browser bundles are minified; the Worker keeps readable code for its stack traces.
    client: {
      build: {
        // Nitro copies public/ with fs.cp, which keeps the symlinks into packages/ui as links.
        // Letting Vite copy it first writes real files.
        copyPublicDir: true,
        minify: "esbuild",
      },
    },
  },
})

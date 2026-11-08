// Production CSS plugins shared by the site's build (vite.config.ts) and the docs' own build
// (src/docs/script/build.ts), so both ship the same stylesheets for the same settings.
import type { PluginOption } from "vite"
import variants from "../src/component/site/css-variants.json"

/**
 * Production only: a stylesheet named *.dev.css is for development tools (Settings, Design mode) and
 * builds empty, so its rules never reach a page's render-blocking CSS.
 */
export function devOnlyCss(): PluginOption {
  return {
    name: "dev-only-css",
    apply: "build",
    enforce: "pre",
    load: (id) => (/\.dev\.css(\?|$)/.test(id) ? "" : undefined),
  }
}

/**
 * Production only: Settings and Design mode are development tools, so the site root's settings
 * attributes always carry the default settings' values (src/component/site/css-variants.json). This
 * drops, from the production CSS, each selector that needs another value of one of them, and each
 * rule left with none; the development server keeps every variant for Design mode. Only attributes
 * outside parentheses count (an attribute inside :not(), :is() or :has() keeps its selector).
 */
export function cssVariantsForProduction(): PluginOption {
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

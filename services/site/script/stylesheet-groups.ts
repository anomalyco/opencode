import type { PluginOption } from "vite"

// Pages that share a layout share a stylesheet: the product pages with the changelog (both show
// release notes), and otherwise each section of the site (the route's first path segment).
const productPages = /^(product|desktop|terminal|mobile|sdk|mini|changelog)(\/|$)/
const shell = /[\\/]src[\\/](app|component[\\/]site[\\/]site)\.tsx$/

/**
 * Production only: every page links two stylesheets, the shell's (`shell-<hash>.css`: the site's
 * frame, its fonts and every stylesheet more than one group of pages uses) and its own group's
 * (`home-`, `product-`, `legal-<hash>.css`, …). Both are content-hashed files that browsers keep for
 * a year, so a visitor downloads the shell once and each group the first time they open one of its
 * pages, whichever page that is. Vite splits stylesheets by JavaScript chunk, so this names a chunk
 * of stylesheets for each: the stylesheets a page's code imports, and none that load on demand
 * (search, the Markdown view, the Hex pop-up), which stay with their own code (script/static-client.ts).
 * Chunks of stylesheets alone leave no JavaScript (Vite's pure CSS chunks).
 */
export function stylesheetGroups(): PluginOption {
  return {
    name: "stylesheet-groups",
    apply: "build",
    configEnvironment: (name) => {
      if (name !== "client") return
      return {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: (id, context) => group(id, (module) => context.getModuleInfo(module)),
                    test: /\.css$/,
                  },
                ],
              },
            },
          },
        },
      }
    },
  }
}

/** The group a stylesheet goes in: the shell's, a group of pages', or none (it loads on demand). */
export function group(id: string, info: (id: string) => { importers: string[] } | null) {
  const groups = new Set<string>()
  const seen = new Set<string>()
  // Up the static imports only, to the shell and the page routes.
  const visit = (module: string) => {
    if (seen.has(module)) return
    seen.add(module)
    const file = module.split("?")[0]
    if (shell.test(file)) return groups.add("shell")
    const route = file.match(/[\\/]src[\\/]routes[\\/](.+)\.tsx$/)?.[1]
    if (route) return groups.add(routeGroup(route.replaceAll("\\", "/")))
    info(module)?.importers.forEach(visit)
  }
  visit(id)
  if (groups.size === 0) return null
  return groups.size === 1 ? [...groups][0] : "shell"
}

function routeGroup(route: string) {
  if (productPages.test(route)) return "product"
  if (route === "index") return "home"
  if (route === "[...404]") return "not-found"
  return route.split("/")[0]
}

import picker from "@brendonovich/vite-plugin-opencode"
import MagicString from "magic-string"
import { existsSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { parseSync, Visitor } from "vite"

const attribute = "data-opencode-picker-source"

export function pickerPlugin() {
  const plugin = picker()
  const client = "/__vite_opencode_picker_client.js"
  let workspaceRoot = ""

  return {
    ...plugin,
    configResolved(config: Parameters<typeof plugin.configResolved>[0]) {
      plugin.configResolved(config)
      workspaceRoot = gitRoot(config.root)
    },
    resolveId(id: string) {
      return plugin.resolveId(id === client ? "virtual:vite-opencode-picker/client" : id)
    },
    configureServer(server: Parameters<typeof plugin.configureServer>[0]) {
      server.middlewares.use(client, (_request, response) => {
        response.setHeader("content-type", "text/javascript")
        response.end(plugin.load(plugin.resolveId("virtual:vite-opencode-picker/client")!))
      })
      plugin.configureServer(server)
    },
    transformIndexHtml: {
      order: "pre" as const,
      handler() {
        // A real URL stays loadable if bundled dev leaves the HTML import unbundled.
        return [{ tag: "script", attrs: { type: "module", src: client }, injectTo: "body" as const }]
      },
    },
    // The package tags elements through a Babel parse and print of every component, a second Babel
    // pass on top of Solid's. Inserting the attribute where Oxc finds each element gives the same tags
    // at about a quarter of the cost, which the first renderer bundle waits on.
    transform(code: string, id: string) {
      const file = id.split("?", 1)[0]

      if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) return
      const source = relative(workspaceRoot, file).replaceAll(sep, "/")

      if (source.startsWith("../")) return
      const parsed = parseSync(file, code)

      if (parsed.errors.length) return
      const lines = [0, ...Array.from(code.matchAll(/\n/g), (match) => match.index + 1)]
      const output = new MagicString(code)

      new Visitor({
        JSXOpeningElement(node) {
          if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return

          if (node.attributes.some((item) => item.type === "JSXAttribute" && item.name.name === attribute)) return
          const line = lines.findLastIndex((start) => start <= node.start) + 1
          output.appendLeft(node.selfClosing ? node.end - 2 : node.end - 1, ` ${attribute}="${source}:${line}"`)
        },
      }).visit(parsed.program)

      if (!output.hasChanged()) return

      return { code: output.toString(), map: output.generateMap({ hires: "boundary", source: file }) }
    },
  }
}

// The package's own root: the nearest directory with a .git entry, so tags name the same paths.
function gitRoot(root: string) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir

    if (dirname(dir) === dir) return resolve(root)
  }
}

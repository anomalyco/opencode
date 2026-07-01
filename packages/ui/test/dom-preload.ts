// Bun test preload for DOM-rendered SolidJS components.
//
// Bun does not run vite-plugin-solid, so we register a Bun plugin that compiles
// JSX/TSX through babel-preset-solid (DOM generate mode) and we register
// happy-dom as the global DOM. Used by component tests that mount real DOM
// (e.g. CodeMirror 6 inside code-editor.tsx).
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { plugin } from "bun"
// @ts-expect-error - no bundled types
import { transformAsync } from "@babel/core"
// @ts-expect-error - no types
import ts from "@babel/preset-typescript"
// @ts-expect-error - no types
import solid from "babel-preset-solid"

if (!(globalThis as any).__ui_dom_registered) {
  GlobalRegistrator.register()
  ;(globalThis as any).__ui_dom_registered = true
}

plugin({
  name: "solid-dom-tsx",
  setup(build) {
    // Force solid-js to resolve to its client (DOM) build instead of the
    // server build that Bun picks up by default.
    build.onLoad({ filter: /[/\\]solid-js[/\\]web[/\\]dist[/\\]server\.js$/ }, async (args) => {
      const path = args.path.replace(/server\.js$/, "web.js")
      return { contents: await Bun.file(path).text(), loader: "js" }
    })
    build.onLoad({ filter: /[/\\]solid-js[/\\]dist[/\\]server\.js$/ }, async (args) => {
      const path = args.path.replace(/server\.js$/, "solid.js")
      return { contents: await Bun.file(path).text(), loader: "js" }
    })

    build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
      if (args.path.includes("/node_modules/")) return
      const source = await Bun.file(args.path).text()
      const result = await transformAsync(source, {
        filename: args.path,
        presets: [
          [solid, { generate: "dom", hydratable: false }],
          [ts, { onlyRemoveTypeImports: true }],
        ],
        sourceMaps: "inline",
      })
      return { contents: result?.code ?? source, loader: "js" }
    })
  },
})

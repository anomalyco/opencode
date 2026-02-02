import { plugin, type BunPlugin } from "bun"
import { transformAsync } from "@babel/core"
import solid from "babel-preset-solid"
import react from "@babel/preset-react"
import ts from "@babel/preset-typescript"

const inkExcludedPlugin: BunPlugin = {
  name: "solid-with-ink-exclusion",
  setup(build) {
    build.onLoad({ filter: /[\\/]node_modules[\\/]solid-js[\\/]dist[\\/]server\.js$/ }, async (args) => {
      try {
        const path = args.path.replace(/(\.server\.js)$/, ".solid.js")
        const file = Bun.file(path)
        if (!(await file.exists())) return undefined
        const code = await file.text()
        return { contents: code, loader: "js" }
      } catch {
        return undefined
      }
    })

    build.onLoad({ filter: /[\\/]node_modules[\\/]solid-js[\\/]store[\\/]dist[\\/]server\.js$/ }, async (args) => {
      try {
        const path = args.path.replace(/(\.server\.js)$/, ".store.js")
        const file = Bun.file(path)
        if (!(await file.exists())) return undefined
        const code = await file.text()
        return { contents: code, loader: "js" }
      } catch {
        return undefined
      }
    })

    build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
      if (args.path.includes("node_modules")) {
        return undefined
      }

      const code = await Bun.file(args.path).text()

      // Detect if file is Ink-related (React-based)
      const isInkFile =
        /from\s*["']ink["']/.test(code) ||
        /from\s*["']ink-/.test(code) ||
        /require\(["']ink["']\)/.test(code) ||
        /@jsxImportSource\s+react/.test(code) ||
        args.path.includes("/cli/ink/") ||
        args.path.includes("/test/cli/ink/")

      if (isInkFile) {
        // Transform with Babel React preset
        const result = await transformAsync(code, {
          filename: args.path,
          presets: [
            ["@babel/preset-react", { runtime: "automatic", importSource: "react" }],
            [ts, { isTSX: true, allExtensions: true }],
          ],
        })
        return { contents: result?.code ?? "", loader: "js" }
      }

      try {
        // Transform with SolidJS preset
        const transforms = await transformAsync(code, {
          filename: args.path,
          presets: [
            [
              solid,
              {
                moduleName: "@opentui/solid",
                generate: "universal",
              },
            ],
            [ts],
          ],
        })

        if (!transforms || !transforms.code) {
          throw new Error(`Transform produced no output: ${args.path}`)
        }

        return {
          contents: transforms.code,
          loader: "js",
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        const fullMessage = errorStack
          ? `SolidJS transform failed for ${args.path}: ${errorMessage}\n${errorStack}`
          : `SolidJS transform failed for ${args.path}: ${errorMessage}`
        throw new Error(fullMessage)
      }
    })
  },
}

plugin(inkExcludedPlugin)

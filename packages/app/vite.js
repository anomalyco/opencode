import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-sdk:prefer-ts",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/packages/sdk/js/src/")) return null
      if (!id.endsWith(".ts")) return null

      return {
        code: code.replaceAll('.js"', '.ts"').replaceAll(".js'", ".ts'"),
        map: null,
      }
    },
  },
  tailwindcss(),
  solidPlugin({
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  }),
]

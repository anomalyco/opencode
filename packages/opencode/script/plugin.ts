import { type BunPlugin } from "bun"

const multiEntryPlugin: BunPlugin = {
  name: "bun-plugin-multi-entry",
  setup: (build) => {
    build.onResolve({ filter: /\/$bunfs\/root\/\.\.\// }, async (args) => {
      return {
        path: args.path.replace("../", ""),
      }
    })
  },
}

export default multiEntryPlugin

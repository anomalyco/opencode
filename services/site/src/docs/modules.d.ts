// The slug of every docs page (vite.ts), so the Worker knows them without loading any content, and
// whether this build renders the restyle (config.ts `restyled`).
declare module "virtual:docs-pages" {
  export const docsSlugs: string[]
  export const restyle: boolean
}

// Solid's Babel preset ships no types; vite.ts passes it straight to Babel.
declare module "babel-preset-solid" {
  import type { PluginItem } from "@babel/core"
  const preset: PluginItem
  export default preset
}

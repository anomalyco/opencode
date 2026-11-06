// The slug of every docs page (vite.ts), so the Worker knows them without loading any content.
declare module "virtual:docs-pages" {
  export const docsSlugs: string[]
}

// Solid's Babel preset ships no types; vite.ts passes it straight to Babel.
declare module "babel-preset-solid" {
  import type { PluginItem } from "@babel/core"
  const preset: PluginItem
  export default preset
}

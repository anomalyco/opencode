import { defineComponents } from "blume"
import Breadcrumbs from "./components/Breadcrumbs.astro"
import ThemeTokens from "./snippets/generated/theme-tokens.mdx"

export default defineComponents({
  layout: {
    Breadcrumbs,
  },
  mdx: {
    ThemeTokens,
  },
})

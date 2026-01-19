import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { docsSchema } from "@astrojs/starlight/schema"

const docsExtensions = [
  "markdown",
  "mdown",
  "mkdn",
  "mkd",
  "mdwn",
  "md",
  "mdx",
  "mdoc",
]

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "src/content/docs",
      pattern: `**/[^_]*.{${docsExtensions.join(",")}}`,
      generateId: ({ entry }) => {
        const withoutExt = entry.replace(/\\/g, "/").replace(/\.[^/.]+$/, "")
        if (withoutExt.startsWith("en/")) return withoutExt.slice(3)
        return withoutExt
      },
    }),
    schema: docsSchema(),
  }),
}

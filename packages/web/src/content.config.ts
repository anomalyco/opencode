import { defineCollection, z } from "astro:content"
import { glob } from "astro/loaders"
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema"
import en from "./content/i18n/en.json"

const custom = Object.fromEntries(Object.keys(en).map((key) => [key, z.string()]))

export const collections = {
  docs: defineCollection({
    loader: glob({ base: "../../docs", pattern: "*.{md,mdx}" }),
    schema: docsSchema(),
  }),
  i18n: defineCollection({
    loader: glob({ base: "./src/content/i18n", pattern: "*.json" }),
    schema: i18nSchema({
      extend: z.object(custom).catchall(z.string()),
    }),
  }),
}

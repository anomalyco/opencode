import { defineCollection, z } from "astro:content"
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders"
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema"
import en from "./content/i18n/en.json"

const custom = Object.fromEntries(Object.keys(en).map((key) => [key, z.string()]))

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({
      extend: z.object(custom).catchall(z.string()),
    }),
  }),
}

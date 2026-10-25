import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { z } from "astro/zod"

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "./src/docs/content",
      pattern: "**/*.{md,mdx}",
    }),
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      tableOfContents: z
        .union([
          z.boolean(),
          z.object({
            minHeadingLevel: z.number().int().min(1).max(6).optional(),
            maxHeadingLevel: z.number().int().min(1).max(6).optional(),
          }),
        ])
        .optional(),
    }),
  }),
}

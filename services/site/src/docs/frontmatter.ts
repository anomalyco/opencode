import { z } from "zod"

// Every page's frontmatter, checked when its MDX compiles (vite.ts), so a bad page fails the build.
export const frontmatterSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  noindex: z.boolean().optional(),
  tableOfContents: z
    .union([
      z.boolean(),
      z.object({
        minHeadingLevel: z.number().int().min(1).max(6).optional(),
        maxHeadingLevel: z.number().int().min(1).max(6).optional(),
      }),
    ])
    .optional(),
})

export type Frontmatter = z.infer<typeof frontmatterSchema>

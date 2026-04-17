import z from "zod"

export const Info = z.object({
  paths: z.array(z.string()).optional().describe("Additional paths to skill folders"),
  urls: z
    .array(z.string())
    .optional()
    .describe("URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)"),
})

export type Info = z.infer<typeof Info>

export * as ConfigSkills from "./skills"

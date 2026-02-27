import z from "zod"

export const Config = z.discriminatedUnion("type", [
  z.object({
    directory: z.string(),
    type: z.literal("worktree"),
  }),
])

export type Config = z.infer<typeof Config>

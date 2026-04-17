export * as ConfigFormatter from "./formatter"

import z from "zod"

export const Entry = z.object({
  disabled: z.boolean().optional(),
  command: z.array(z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  extensions: z.array(z.string()).optional(),
})

export const Info = z.union([z.boolean(), z.record(z.string(), Entry)])
export type Info = z.infer<typeof Info>

import z from "zod"

export const OpenRouterConfig = z
  .object({
    freeRouter: z
      .boolean()
      .optional()
      .default(false)
      .describe("Enable the OpenRouter free router model (openrouter/free)"),
    freeVariants: z
      .boolean()
      .optional()
      .default(false)
      .describe("Enable free model variants for OpenRouter (append :free)"),
  })
  .strict()
  .meta({
    ref: "OpenRouterConfig",
  })

export type OpenRouterConfig = z.infer<typeof OpenRouterConfig>

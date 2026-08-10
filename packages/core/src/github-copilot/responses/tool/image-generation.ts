import { z } from "zod/v4"

export const imageGenerationArgsSchema = z
  .object({
    background: z.enum(["auto", "opaque", "transparent"]).optional(),
    inputFidelity: z.enum(["low", "high"]).optional(),
    inputImageMask: z
      .object({
        fileId: z.string().optional(),
        imageUrl: z.string().optional(),
      })
      .optional(),
    model: z.string().optional(),
    moderation: z.enum(["auto"]).optional(),
    outputCompression: z.number().int().min(0).max(100).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
    partialImages: z.number().int().min(0).max(3).optional(),
    quality: z.enum(["auto", "low", "medium", "high"]).optional(),
    size: z.enum(["1024x1024", "1024x1536", "1536x1024", "auto"]).optional(),
  })
  .strict()

export const imageGenerationOutputSchema = z.object({
  result: z.string(),
})

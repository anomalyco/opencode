import { createProviderDefinedToolFactoryWithOutputSchema } from "@ai-sdk/provider-utils"
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

type ImageGenerationArgs = {
  /**
   * Background type for the generated image. Default is 'auto'.
   */
  background?: "auto" | "opaque" | "transparent"

  /**
   * Input fidelity for the generated image. Default is 'low'.
   */
  inputFidelity?: "low" | "high"

  /**
   * Optional mask for inpainting.
   * Contains image_url (string, optional) and file_id (string, optional).
   */
  inputImageMask?: {
    /**
     * File ID for the mask image.
     */
    fileId?: string

    /**
     * Base64-encoded mask image.
     */
    imageUrl?: string
  }

  /**
   * The image generation model to use. Default: gpt-image-1.
   */
  model?: string

  /**
   * Moderation level for the generated image. Default: auto.
   */
  moderation?: "auto"

  /**
   * Compression level for the output image. Default: 100.
   */
  outputCompression?: number

  /**
   * The output format of the generated image. One of png, webp, or jpeg.
   * Default: png
   */
  outputFormat?: "png" | "jpeg" | "webp"

  /**
   * Number of partial images to generate in streaming mode, from 0 (default value) to 3.
   */
  partialImages?: number

  /**
   * The quality of the generated image.
   * One of low, medium, high, or auto. Default: auto.
   */
  quality?: "auto" | "low" | "medium" | "high"

  /**
   * The size of the generated image.
   * One of 1024x1024, 1024x1536, 1536x1024, or auto.
   * Default: auto.
   */
  size?: "auto" | "1024x1024" | "1024x1536" | "1536x1024"
}

const imageGenerationToolFactory = createProviderDefinedToolFactoryWithOutputSchema<
  {},
  {
    /**
     * The generated image encoded in base64.
     */
    result: string
  },
  ImageGenerationArgs
>({
  id: "openai.image_generation",
  name: "image_generation",
  inputSchema: z.object({}),
  outputSchema: imageGenerationOutputSchema,
})

export const imageGeneration = (
  args: ImageGenerationArgs = {}, // default
) => {
  return imageGenerationToolFactory(args)
}

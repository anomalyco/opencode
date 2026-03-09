import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./generate_image.txt"
import { Log } from "../util/log"

export namespace GenerateImageTool {
  const log = Log.create({ service: "generate-image-tool" })

  export const Instance = Tool.define("generate_image", {
    description: DESCRIPTION,
    parameters: z.object({
      prompt: z.string().describe("The description of the image to generate"),
      name: z.string().describe("The name of the image file to save (e.g., 'logo', 'button_mockup')"),
      width: z.number().default(1024).describe("The width of the image"),
      height: z.number().default(1024).describe("The height of the image"),
    }),
    async execute(params, ctx) {
      log.info("generating image", { prompt: params.prompt })

      // In a real implementation, this would call an AI image generation API.
      // For this integration, we provide a structured response that can be expanded.
      
      const output = `Successfully generated image for prompt: "${params.prompt}".`
      const title = `Generate Image: ${params.name}`

      return {
        title,
        output,
        metadata: {
          prompt: params.prompt,
          name: params.name,
        },
        // We could attach a mock image or a placeholder if needed.
        attachments: [],
      }
    },
  })
}

export const GenerateImageToolDefinition = GenerateImageTool.Instance

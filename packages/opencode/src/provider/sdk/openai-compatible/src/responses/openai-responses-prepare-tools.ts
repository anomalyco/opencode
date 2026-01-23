import {
  type LanguageModelV2CallOptions,
  type LanguageModelV2CallWarning,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import { codeInterpreterArgsSchema } from "./tool/code-interpreter"
import { fileSearchArgsSchema } from "./tool/file-search"
import { webSearchArgsSchema } from "./tool/web-search"
import { webSearchPreviewArgsSchema } from "./tool/web-search-preview"
import { imageGenerationArgsSchema } from "./tool/image-generation"
import type { OpenAIResponsesTool } from "./openai-responses-api-types"

export function prepareResponsesTools({
  tools,
  toolChoice,
  strictJsonSchema,
}: {
  tools: LanguageModelV2CallOptions["tools"]
  toolChoice?: LanguageModelV2CallOptions["toolChoice"]
  strictJsonSchema: boolean
}): {
  tools?: Array<OpenAIResponsesTool>
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "file_search" }
    | { type: "web_search_preview" }
    | { type: "web_search" }
    | { type: "function"; name: string }
    | { type: "code_interpreter" }
    | { type: "image_generation" }
  toolWarnings: LanguageModelV2CallWarning[]
} {
  // when the tools array is empty, change it to undefined to prevent errors:
  tools = tools?.length ? tools : undefined

  const toolWarnings: LanguageModelV2CallWarning[] = []

  if (tools == null) {
    return { tools: undefined, toolChoice: undefined, toolWarnings }
  }

  const openaiTools: Array<OpenAIResponsesTool> = []

  for (const tool of tools) {
    switch (tool.type) {
      case "function":
        openaiTools.push({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: strictJsonSchema,
        })
        break
      case "provider-defined": {
        switch (tool.id) {
          case "openai.file_search": {
            const args = fileSearchArgsSchema.parse(tool.args)

            openaiTools.push({
              type: "file_search",
              vector_store_ids: args.vectorStoreIds,
              max_num_results: args.maxNumResults,
              ranking_options: args.ranking
                ? {
                    ranker: args.ranking.ranker,
                    score_threshold: args.ranking.scoreThreshold,
                  }
                : undefined,
              filters: args.filters,
            })

            break
          }
          case "openai.local_shell": {
            openaiTools.push({
              type: "local_shell",
            })
            break
          }
          case "openai.web_search_preview": {
            const args = webSearchPreviewArgsSchema.parse(tool.args)
            openaiTools.push({
              type: "web_search_preview",
              search_context_size: args.searchContextSize,
              user_location: args.userLocation,
            })
            break
          }
          case "openai.web_search": {
            const args = webSearchArgsSchema.parse(tool.args)
            openaiTools.push({
              type: "web_search",
              filters: args.filters != null ? { allowed_domains: args.filters.allowedDomains } : undefined,
              search_context_size: args.searchContextSize,
              user_location: args.userLocation,
            })
            break
          }
          case "openai.code_interpreter": {
            const args = codeInterpreterArgsSchema.parse(tool.args)
            openaiTools.push({
              type: "code_interpreter",
              container:
                args.container == null
                  ? { type: "auto", file_ids: undefined }
                  : typeof args.container === "string"
                    ? args.container
                    : { type: "auto", file_ids: args.container.fileIds },
            })
            break
          }
          case "openai.image_generation": {
            const args = imageGenerationArgsSchema.parse(tool.args)
            openaiTools.push({
              type: "image_generation",
              background: args.background,
              input_fidelity: args.inputFidelity,
              input_image_mask: args.inputImageMask
                ? {
                    file_id: args.inputImageMask.fileId,
                    image_url: args.inputImageMask.imageUrl,
                  }
                : undefined,
              model: args.model,
              moderation: args.moderation,
              partial_images: args.partialImages,
              quality: args.quality,
              output_compression: args.outputCompression,
              output_format: args.outputFormat,
              size: args.size,
            })
            break
          }
        }
        break
      }
      default:
        toolWarnings.push({ type: "unsupported-tool", tool })
        break
    }
  }

  if (toolChoice == null) {
    return { tools: openaiTools, toolChoice: undefined, toolWarnings }
  }

  const type = toolChoice.type

  switch (type) {
    case "auto":
    case "none":
    case "required":
      return { tools: openaiTools, toolChoice: type, toolWarnings }
    case "tool":
      return {
        tools: openaiTools,
        toolChoice:
          toolChoice.toolName === "code_interpreter" ||
          toolChoice.toolName === "file_search" ||
          toolChoice.toolName === "image_generation" ||
          toolChoice.toolName === "web_search_preview" ||
          toolChoice.toolName === "web_search"
            ? { type: toolChoice.toolName }
            : { type: "function", name: toolChoice.toolName },
        toolWarnings,
      }
    default: {
      const _exhaustiveCheck: never = type
      throw new UnsupportedFunctionalityError({
        functionality: `tool choice type: ${_exhaustiveCheck}`,
      })
    }
  }
}

import {
  type LanguageModelV3CallOptions,
  type LanguageModelV3ProviderTool,
  type SharedV3Warning,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import { codeInterpreterArgsSchema } from "./tool/code-interpreter.js"
import { fileSearchArgsSchema } from "./tool/file-search.js"
import { webSearchArgsSchema } from "./tool/web-search.js"
import { webSearchPreviewArgsSchema } from "./tool/web-search-preview.js"
import { imageGenerationArgsSchema } from "./tool/image-generation.js"
import type { OpenAIResponsesTool } from "./openai-responses-api-types.js"

export type ResponsesHostedTool = {
  name: string
  type: "file_search" | "web_search_preview" | "web_search" | "code_interpreter" | "image_generation"
  responseType: "file_search" | "web_search" | "code_interpreter" | "image_generation"
}

export function getResponsesHostedTool(tool: LanguageModelV3ProviderTool): ResponsesHostedTool | undefined {
  switch (tool.id) {
    case "openai.file_search":
      return { name: tool.name, type: "file_search", responseType: "file_search" }
    case "openai.web_search_preview":
      return { name: tool.name, type: "web_search_preview", responseType: "web_search" }
    case "openai.web_search":
      return { name: tool.name, type: "web_search", responseType: "web_search" }
    case "openai.code_interpreter":
      return { name: tool.name, type: "code_interpreter", responseType: "code_interpreter" }
    case "openai.image_generation":
      return { name: tool.name, type: "image_generation", responseType: "image_generation" }
  }
  return undefined
}

export function prepareResponsesTools({
  tools,
  toolChoice,
  strictJsonSchema,
}: {
  tools: LanguageModelV3CallOptions["tools"]
  toolChoice?: LanguageModelV3CallOptions["toolChoice"]
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
  hostedTools: ResponsesHostedTool[]
  selectedHostedTool?: ResponsesHostedTool
  toolWarnings: SharedV3Warning[]
} {
  // when the tools array is empty, change it to undefined to prevent errors:
  tools = tools?.length ? tools : undefined

  const toolWarnings: SharedV3Warning[] = []

  if (tools == null) {
    return { tools: undefined, toolChoice: undefined, hostedTools: [], toolWarnings }
  }

  const hostedTools = tools.flatMap((tool) => {
    if (tool.type !== "provider") return []
    const hostedTool = getResponsesHostedTool(tool)
    return hostedTool ? [hostedTool] : []
  })
  const selectedToolName = toolChoice?.type === "tool" ? toolChoice.toolName : undefined
  const selectedTools = selectedToolName === undefined ? [] : tools.filter((tool) => tool.name === selectedToolName)
  if (selectedTools.length > 1) {
    throw new UnsupportedFunctionalityError({
      functionality: `ambiguous tool choice '${selectedToolName}': multiple tool definitions share this name`,
    })
  }
  const selectedHostedTool =
    selectedTools[0]?.type === "provider" ? getResponsesHostedTool(selectedTools[0]) : undefined

  const ambiguousHostedResponse =
    toolChoice?.type === "none" || toolChoice?.type === "tool"
      ? undefined
      : hostedTools.find(
          (tool) =>
            new Set(
              hostedTools.filter((candidate) => candidate.responseType === tool.responseType).map((item) => item.name),
            ).size > 1,
        )
  if (ambiguousHostedResponse) {
    const names = new Set(
      hostedTools.filter((tool) => tool.responseType === ambiguousHostedResponse.responseType).map((tool) => tool.name),
    )
    throw new UnsupportedFunctionalityError({
      functionality: `ambiguous ${ambiguousHostedResponse.responseType} response for hosted tools: ${[...names].join(", ")}`,
    })
  }

  if (selectedHostedTool) {
    const names = new Set(hostedTools.filter((tool) => tool.type === selectedHostedTool.type).map((tool) => tool.name))
    if (names.size > 1) {
      throw new UnsupportedFunctionalityError({
        functionality: `ambiguous ${selectedHostedTool.type} tool choice for hosted tools: ${[...names].join(", ")}`,
      })
    }
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
          strict: tool.strict ?? strictJsonSchema,
        })
        break
      case "provider": {
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
        toolWarnings.push({ type: "unsupported", feature: "tool type" })
        break
    }
  }

  if (toolChoice == null) {
    return { tools: openaiTools, toolChoice: undefined, hostedTools, selectedHostedTool, toolWarnings }
  }

  const type = toolChoice.type

  switch (type) {
    case "auto":
    case "none":
    case "required":
      return { tools: openaiTools, toolChoice: type, hostedTools, selectedHostedTool, toolWarnings }
    case "tool": {
      return {
        tools: openaiTools,
        toolChoice: selectedHostedTool
          ? { type: selectedHostedTool.type }
          : { type: "function", name: toolChoice.toolName },
        hostedTools,
        selectedHostedTool,
        toolWarnings,
      }
    }
    default: {
      const _exhaustiveCheck: never = type
      throw new UnsupportedFunctionalityError({
        functionality: `tool choice type: ${_exhaustiveCheck}`,
      })
    }
  }
}

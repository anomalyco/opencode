import { Model, Patch } from "../patch"
import type { ContentPart, LLMRequest } from "../schema"

const removeEmptyParts = (content: ReadonlyArray<ContentPart>) =>
  content.filter((part) => (part.type === "text" || part.type === "reasoning" ? part.text !== "" : true))

const rewriteToolIds = (request: LLMRequest, scrub: (id: string) => string): LLMRequest => ({
  ...request,
  messages: request.messages.map((message) => {
    if (message.role !== "assistant" && message.role !== "tool") return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "tool-call" || part.type === "tool-result") return { ...part, id: scrub(part.id) }
        return part
      }),
    }
  }),
})

export const removeEmptyAnthropicContent = Patch.prompt("anthropic.remove-empty-content", {
  reason: "remove empty text/reasoning blocks for providers that reject empty content",
  when: Model.provider("anthropic").or(Model.provider("bedrock"), Model.provider("amazon-bedrock")),
  apply: (request) => ({
    ...request,
    system: request.system.filter((part) => part.text !== ""),
    messages: request.messages
      .map((message) => ({ ...message, content: removeEmptyParts(message.content) }))
      .filter((message) => message.content.length > 0),
  }),
})

export const scrubClaudeToolIds = Patch.prompt("anthropic.scrub-tool-call-ids", {
  reason: "Claude tool_use ids only accept alphanumeric, underscore, and dash characters",
  when: Model.idIncludes("claude"),
  apply: (request) => rewriteToolIds(request, (id) => id.replace(/[^a-zA-Z0-9_-]/g, "_")),
})

export const scrubMistralToolIds = Patch.prompt("mistral.scrub-tool-call-ids", {
  reason: "Mistral tool call ids must be short alphanumeric identifiers",
  when: Model.provider("mistral").or(Model.idIncludes("mistral"), Model.idIncludes("devstral")),
  apply: (request) => rewriteToolIds(request, (id) => id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 9).padEnd(9, "0")),
})

export const defaults = [removeEmptyAnthropicContent, scrubClaudeToolIds, scrubMistralToolIds]

export * as ProviderPatch from "./patch"

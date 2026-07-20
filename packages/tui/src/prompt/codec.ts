import type { Prompt, PromptInput } from "@opencode-ai/schema"
import type { Types } from "effect"

export type EditablePromptInput = Types.DeepMutable<PromptInput.Prompt>

export function projectedPromptInput(input: Pick<Prompt, "text" | "files" | "agents">): EditablePromptInput {
  return {
    text: input.text,
    files: input.files?.map((file) => ({
      uri: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
      name: file.name,
      description: file.description,
      mention: file.mention ? { ...file.mention } : undefined,
    })),
    agents: input.agents?.map((agent) => ({
      name: agent.name,
      mention: agent.mention ? { ...agent.mention } : undefined,
    })),
  }
}

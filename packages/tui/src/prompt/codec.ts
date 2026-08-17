import type { Prompt, PromptInput } from "@opencode-ai/schema"
import { Skill } from "@opencode-ai/schema/skill"
import type { Types } from "effect"

export type EditablePromptInput = Types.DeepMutable<PromptInput.Prompt>

type ProjectedPrompt = Pick<Prompt, "text" | "files" | "agents"> & {
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention?: PromptInput.SkillAttachment["mention"] }>
}

export function projectedPromptInput(input: ProjectedPrompt): EditablePromptInput {
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
    skills: input.skills?.map((skill) => ({
      id: Skill.ID.make(skill.id),
      mention: skill.mention ? { ...skill.mention } : undefined,
    })),
  }
}

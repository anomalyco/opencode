import { mediaHashFromUri, type PromptAttachment } from "@opencode/client"
import type { Prompt, PromptInput } from "@opencode/schema"
import { Skill } from "@opencode/schema/skill"
import type { Types } from "effect"

export type EditablePromptInput = Types.DeepMutable<PromptInput.Prompt>

export type ProjectedPrompt = Pick<Prompt, "text" | "agents"> & {
  readonly files?: ReadonlyArray<PromptAttachment>
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention?: PromptInput.SkillAttachment["mention"] }>
}

/** A projected prompt as composer input. Files the server kept as `media:<hash>` refs stay refs. */
export function projectedPromptInput(input: ProjectedPrompt): EditablePromptInput {
  return {
    text: input.text,
    files: input.files?.map((file) => ({
      uri:
        file.source.type === "uri"
          ? file.source.uri
          : "uri" in file
            ? file.uri
            : `data:${file.mime};base64,${file.data}`,
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

/**
 * {@link projectedPromptInput} with every `media:<hash>` file read back into a `data:` URI, for putting a sent prompt
 * back in the composer. The draft then keeps its bytes after the server releases the blob (an inbox cancel, or a
 * committed revert), and the composer previews and resends it like any pasted image. A read that resolves `undefined`
 * leaves its file out.
 */
export async function restoredPromptInput(
  input: ProjectedPrompt,
  read: (uri: string) => Promise<Uint8Array | undefined>,
): Promise<EditablePromptInput> {
  const output = projectedPromptInput(input)
  if (!output.files?.some((file) => mediaHashFromUri(file.uri))) return output
  const files = await Promise.all(
    output.files.map(async (file, index) => {
      if (!mediaHashFromUri(file.uri)) return [file]
      const bytes = await read(file.uri)
      if (!bytes) return []
      const mime = input.files?.[index]?.mime ?? "application/octet-stream"
      return [{ ...file, uri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` }]
    }),
  )
  return { ...output, files: files.flat() }
}

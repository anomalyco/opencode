import type { SessionMessageAssistantTool, SessionMessageUser } from "@opencode-ai/client/promise"
import { deduplicateVisibleImages } from "../prompt/attachment"
import { toolDisplayContent } from "../util/tool-display"
import type { StreamCommit } from "./types"

export type ImageCommit = StreamCommit & { image: string; messageID: string; partID: string }

export function userImageCommits(messageID: string, files: SessionMessageUser["files"]): ImageCommit[] {
  return deduplicateVisibleImages(files ?? [])
    .filter((file) => file.mime.startsWith("image/"))
    .map((file, index) => ({
      kind: "user",
      source: "system",
      text: file.name ?? file.mention?.text ?? `[Image ${index + 1}]`,
      image: `data:${file.mime};base64,${file.data}`,
      phase: "final",
      messageID,
      partID: `image:${index}`,
    }))
}

export function toolImageCommits(part: SessionMessageAssistantTool, messageID: string): ImageCommit[] {
  return toolDisplayContent(part.state)
    .flatMap((content) =>
      content.type === "file" && content.mime.startsWith("image/") && content.uri.startsWith("data:image/")
        ? [content]
        : [],
    )
    .map((content, index) => ({
      kind: "tool",
      source: "tool",
      text: content.name ?? `[Image ${index + 1}]`,
      image: content.uri,
      phase: "final",
      messageID,
      partID: `prt_${part.id}:image:${index}`,
    }))
}

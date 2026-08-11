import type { PromptInput } from "@opencode-ai/schema"

type PromptFile = PromptInput.FileAttachment

export function isReusablePromptAttachment(uri: string) {
  return uri.startsWith("data:image/") || uri.startsWith("data:application/pdf;")
}

export function deduplicatePromptAttachments(files: readonly PromptFile[] | undefined) {
  if (!files || files.length < 2) return files
  const seen = new Set<string>()
  return files.filter((file) => {
    if (!isReusablePromptAttachment(file.uri)) return true
    if (seen.has(file.uri)) return false
    seen.add(file.uri)
    return true
  })
}

export function promptAttachmentLabel(files: readonly PromptFile[] | undefined, uri: string) {
  const pdf = uri.startsWith("data:application/pdf;")
  const existing = files?.find((file) => file.uri === uri)?.mention?.text
  if (existing) return existing

  const prefix = pdf ? "data:application/pdf;" : "data:image/"
  const attachments = deduplicatePromptAttachments(files)
  const count = attachments?.filter((file) => file.uri.startsWith(prefix)).length ?? 0
  return `${pdf ? "PDF" : "Image"} ${count + 1}`
}

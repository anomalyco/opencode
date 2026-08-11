import type { PromptInput } from "@opencode-ai/schema"

type PromptFile = PromptInput.FileAttachment

export function deduplicatePromptImages(files: readonly PromptFile[] | undefined) {
  if (!files || files.length < 2) return files
  const seen = new Set<string>()
  return files.filter((file) => {
    if (!file.uri.startsWith("data:image/")) return true
    if (seen.has(file.uri)) return false
    seen.add(file.uri)
    return true
  })
}

export function promptAttachmentLabel(files: readonly PromptFile[] | undefined, uri: string) {
  const pdf = uri.startsWith("data:application/pdf;")
  const existing = !pdf && files?.find((file) => file.uri === uri)?.mention?.text
  if (existing) return existing

  const prefix = pdf ? "data:application/pdf;" : "data:image/"
  const attachments = pdf ? files : deduplicatePromptImages(files)
  const count = attachments?.filter((file) => file.uri.startsWith(prefix)).length ?? 0
  return `[${pdf ? "PDF" : "Image"} ${count + 1}]`
}

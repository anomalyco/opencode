import type { PromptInfo } from "./history"

type PromptFile = NonNullable<PromptInfo["files"]>[number]

export function deduplicatePromptFiles(files: readonly PromptFile[] | undefined) {
  if (!files) return undefined
  const seen = new Set<string>()
  return files.filter((file) => {
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
  const count = deduplicatePromptFiles(files)?.filter((file) => file.uri.startsWith(prefix)).length ?? 0
  return `[${pdf ? "PDF" : "Image"} ${count + 1}]`
}

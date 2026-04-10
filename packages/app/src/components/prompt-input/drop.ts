type DropDataTransfer = Pick<DataTransfer, "files" | "getData">

export function getDroppedPromptData(dataTransfer: DropDataTransfer | null | undefined): {
  files: File[]
  filePath?: string
} {
  const files = Array.from(dataTransfer?.files ?? [])
  if (files.length > 0) return { files }

  const plainText = dataTransfer?.getData("text/plain")
  const filePrefix = "file:"
  if (plainText?.startsWith(filePrefix)) {
    return { files: [], filePath: plainText.slice(filePrefix.length) }
  }

  return { files: [] }
}

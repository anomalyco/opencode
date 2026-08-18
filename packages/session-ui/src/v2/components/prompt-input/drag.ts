export const PROMPT_FILE_DRAG_TYPE = "application/x-opencode-file"

export function isPromptAttachmentDrag(event: Pick<DragEvent, "dataTransfer">) {
  const types = event.dataTransfer?.types
  if (!types) return false
  return types.includes("Files") || types.includes(PROMPT_FILE_DRAG_TYPE)
}

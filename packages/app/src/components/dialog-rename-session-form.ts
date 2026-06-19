export function validateSessionRename(input: { title: string; currentTitle: string }) {
  const title = input.title.trim()
  if (!title) {
    return { result: undefined, error: "dialog.session.rename.error.empty" as const }
  }
  if (title === input.currentTitle.trim()) {
    return { result: undefined, error: undefined }
  }
  return { result: { title }, error: undefined }
}

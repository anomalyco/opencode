export async function archiveHomeSession(input: {
  sessionID: string
  archive: (sessionID: string) => Promise<unknown>
  remove: () => void
  onError?: (error: unknown) => void
}) {
  await input
    .archive(input.sessionID)
    .then(() => {
      input.remove()
    })
    .catch((error) => input.onError?.(error))
}

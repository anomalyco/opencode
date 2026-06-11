export async function openDefaultPath(openPath: (path: string) => Promise<string>, path: string) {
  // Electron returns an error message string here instead of rejecting.
  const message = await openPath(path)
  if (message) throw new Error(message)
}

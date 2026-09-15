export async function revealProject(input: {
  directory: string
  reveal: (directory: string) => Promise<boolean>
  remove: (directory: string) => void
}) {
  if (await input.reveal(input.directory)) return true
  input.remove(input.directory)
  return false
}

export function syncProject(directory: string | undefined, open: (directory: string) => void) {
  if (!directory) return
  open(directory)
}

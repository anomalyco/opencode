export function getFilename(path: string) {
  const parts = path.split("/")
  return parts[parts.length - 1]
}

export function getFileExtension(path: string) {
  const parts = path.split(".")
  return parts[parts.length - 1]
}

export const messageIdFromHash = (hash: string) => {
  const value = hash.startsWith("#") ? hash.slice(1) : hash
  const match = value.match(/^message-(.+)$/)
  if (!match) return
  return match[1]
}

export function parseBtwCommand(input: string) {
  const match = input.match(/^\/btw(?:\s+([\s\S]*))?$/)
  if (!match) return
  return (match[1] ?? "").trim()
}

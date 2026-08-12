export function isTitleRequest(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.messages)) return false
  const first = body.messages.find(isMessageObject)
  const firstContent = messageContent(first)
  if (
    first?.role === "user" &&
    firstContent?.startsWith("Generate a title for this conversation:")
  )
    return true
  const system = body.messages.find(
    (message) => isMessageObject(message) && message.role === "system",
  )
  return messageContent(system)?.startsWith("You are a title generator.") ?? false
}

export function* chunkText(text: string, chunkSize: number) {
  const characters = Array.from(text)
  for (let index = 0; index < characters.length; ) {
    const size = Math.max(
      1,
      chunkSize + Math.floor(Math.random() * 11) - 5,
    )
    const end = Math.min(characters.length, index + size)
    yield characters.slice(index, end).join("")
    index = end
  }
}

function isMessageObject(value: unknown) {
  return isRecord(value) && typeof value.role === "string"
}

function messageContent(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined
  const content = message.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (isRecord(part) && typeof part.text === "string") return part.text
      return ""
    })
    .join("")
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

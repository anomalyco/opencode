export function decodeInput(message: unknown, decoder: TextDecoder): string {
  const data =
    typeof message === "object" && message !== null && "data" in message
      ? (message as { data: unknown }).data
      : message

  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return decoder.decode(data)
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  return ""
}

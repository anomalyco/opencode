const asciiDecoder = new TextDecoder()

export type AsciiBuffer = {
  getRealCharBytes(addLineBreaks: boolean): Uint8Array
}

export function bufferToAscii(buffer: AsciiBuffer): string {
  const bytes = buffer.getRealCharBytes(true)
  if (!bytes || bytes.length === 0) return ""
  return asciiDecoder.decode(bytes)
}

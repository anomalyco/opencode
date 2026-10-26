// The native codecs (Chromium 140, Firefox 133, Safari 18.2) run about 100 times faster than a string round trip. The
// type libraries declare them, but older web browsers lack them, so each is read as possibly missing first.
const nativeEncode: (() => string) | undefined = Uint8Array.prototype.toBase64
const nativeDecode: ((value: string) => Uint8Array) | undefined = Uint8Array.fromBase64

/** Encodes bytes as standard base64. */
export function bytesToBase64(bytes: Uint8Array) {
  if (nativeEncode) return bytes.toBase64()

  const parts: string[] = []

  for (let index = 0; index < bytes.length; index += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)))
  }

  return btoa(parts.join(""))
}

/** Decodes standard base64 into bytes. */
export function base64ToBytes(value: string) {
  if (nativeDecode) return Uint8Array.fromBase64(value)

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)

  return bytes
}

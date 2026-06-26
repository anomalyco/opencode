export type SessionHistoryCursor = string

export const SessionHistoryCursor = {
  after(sequence: number): SessionHistoryCursor {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new RangeError("Session history sequence must be a non-negative safe integer")
    }
    return encode({ after: sequence })
  },
}

function encode(value: { readonly after: number }) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

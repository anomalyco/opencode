/** Concatenate byte chunks in order; a single chunk is returned as-is. */
export const concatBytes = (chunks: ReadonlyArray<Uint8Array>) => {
  if (chunks.length === 1) return chunks[0]
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset)
    return offset + chunk.length
  }, 0)
  return bytes
}

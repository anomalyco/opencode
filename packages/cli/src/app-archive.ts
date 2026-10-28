import { Schema } from "effect"

// The web UI the CLI serves, embedded as one binary file: a little-endian u32 byte length of a JSON index, the index of
// each asset's [offset, length] in the body, then the body of brotli-compressed assets. Raw bytes keep the archive the
// size of its compressed assets; a JavaScript string would add base64's third, and Bun's bytecode stores it twice.

const decodeIndex = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Tuple([Schema.Number, Schema.Number]))),
)

export function encode(entries: ReadonlyArray<readonly [string, Uint8Array]>) {
  const offsets = entries.reduce<{ at: number; index: Record<string, [number, number]> }>(
    (state, [key, body]) => {
      state.index[key] = [state.at, body.length]
      state.at += body.length
      return state
    },
    { at: 0, index: {} },
  )
  const index = new TextEncoder().encode(JSON.stringify(offsets.index))
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, index.length, true)
  return Buffer.concat([header, index, ...entries.map((entry) => entry[1])])
}

/** Each asset's compressed bytes, as views into the archive. */
export function decode(archive: Uint8Array): Readonly<Record<string, Uint8Array>> {
  const length = new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(0, true)
  const body = 4 + length
  return Object.fromEntries(
    Object.entries(decodeIndex(new TextDecoder().decode(archive.subarray(4, body)))).map(([key, [offset, size]]) => [
      key,
      archive.subarray(body + offset, body + offset + size),
    ]),
  )
}

export * as AppArchive from "./app-archive"

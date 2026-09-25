const length = 26
// Date.now() * 0x1000 needs 53 bits. A 6-byte time field holds 48, so the top
// bits were dropped and the sortable prefix wrapped every 2^36 ms, about 795
// days. The last wrap was 2026-08-14T11:19:55Z, which sorted every id minted
// after it below the preceding two years of history. 7 bytes hold the encoding
// until 2527. Ids stay 26 characters.
const timeBytes = 7
export const timeChars = timeBytes * 2
const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastTimestamp = 0
let counter = 0

export function ascending() {
  return create(false)
}

export function descending() {
  return create(true)
}

export function create(descending: boolean, timestamp = Date.now()) {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++

  const current = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const value = descending ? ~current : current
  const time = Array.from({ length: timeBytes }, (_, index) =>
    Number((value >> BigInt(8 * (timeBytes - 1 - index))) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  const bytes = crypto.getRandomValues(new Uint8Array(length - timeChars))
  return time + Array.from(bytes, (byte) => chars[byte % 62]).join("")
}

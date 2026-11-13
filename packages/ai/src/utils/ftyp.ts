// Sniff only the leading file type box. A sample may end in the compatible brands,
// but require the major brand and minor version, and a plausible size for a partial box.
export function detectFtyp(bytes: Uint8Array) {
  if (bytes.length < 16) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4) !== 0x66747970) return // ftyp
  const size = view.getUint32(0)
  const header = size === 1 ? 16 : 8
  if (bytes.length < header + 8) return
  const end = size === 1 ? Number(view.getBigUint64(8)) : size
  // Zero extends to EOF. Allow an incomplete, explicitly sized box up to 64 KiB.
  if (size !== 0 && (end < header + 8 || end % 4 !== 0 || end > Math.max(bytes.length, 64 * 1024))) return
  const brand = String.fromCharCode(...bytes.subarray(header, header + 4))
  if (brand === "avif" || brand === "avis") return "image/avif"
  if (brand === "mif1" || brand === "msf1") {
    // Look at most 256 bytes into the box, even when sniffing the entire file.
    const limit = Math.min(end || bytes.length, bytes.length, 256)
    for (let pos = header + 8; pos + 4 <= limit; pos += 4) {
      const compatible = view.getUint32(pos)
      if (compatible === 0x61766966 || compatible === 0x61766973) return "image/avif" // avif or avis
    }
    return "image/heic"
  }
  if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic"
  if (brand === "qt  ") return "video/quicktime"
  if (brand === "M4A ") return "audio/mp4"
  return "video/mp4"
}

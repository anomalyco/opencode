export const dimensions = (data: Uint8Array) => {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
    return {
      width: readUint32(data, 16),
      height: readUint32(data, 20),
    }
  if (data[0] === 0xff && data[1] === 0xd8) {
    for (let offset = 2; offset + 8 < data.length; ) {
      if (data[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = data[offset + 1]
      if (
        marker !== undefined &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
      )
        return {
          width: (data[offset + 7] << 8) | data[offset + 8],
          height: (data[offset + 5] << 8) | data[offset + 6],
        }
      offset += 2 + ((data[offset + 2] << 8) | data[offset + 3])
    }
  }
  throw new Error("Unsupported image fixture format")
}

const readUint32 = (data: Uint8Array, offset: number) =>
  ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0

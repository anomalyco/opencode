#!/usr/bin/env bun
/* [fork-only] DeskFox PNG → ICO 转换器(Bun 原生,无外部依赖)
 *
 * 用法:bun packages/branding/scripts/png-to-ico.ts <out.ico> <png1> <png2> ...
 *
 * .ico 格式参考:https://en.wikipedia.org/wiki/ICO_(file_format)
 *   - 6 字节 ICONDIR 头:reserved(2) + type(2, =1 ICO) + count(2, LE)
 *   - 每个 entry 16 字节 ICONDIRENTRY:width(1) + height(1) + colorCount(1) + reserved(1)
 *     + planes(2, LE) + bpp(2, LE) + dataSize(4, LE) + dataOffset(4, LE)
 *   - 拼接图像数据(支持 PNG payload,Vista+ Windows 全支持)
 *   - 注:width/height 为 256 时写 0(8 位放不下 256)
 */
import { readFileSync, writeFileSync } from "node:fs"

function main() {
  const [outPath, ...pngPaths] = Bun.argv.slice(2)
  if (!outPath || pngPaths.length === 0) {
    console.error("Usage: bun png-to-ico.ts <out.ico> <png1> [png2] ...")
    process.exit(1)
  }

  const pngs = pngPaths.map((p) => {
    const data = readFileSync(p)
    // 从 PNG IHDR 读宽高(IHDR chunk 在文件开头第 16-23 字节,big-endian)
    if (data.readUInt32BE(0) !== 0x89504e47) {
      throw new Error(`${p} is not a PNG`)
    }
    const width = data.readUInt32BE(16)
    const height = data.readUInt32BE(20)
    return { path: p, data, width, height }
  })

  const HEADER_SIZE = 6
  const ENTRY_SIZE = 16
  const dataOffset = HEADER_SIZE + ENTRY_SIZE * pngs.length

  const buffers: Buffer[] = []

  // ICONDIR 头
  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = 1 (ICO)
  header.writeUInt16LE(pngs.length, 4) // count
  buffers.push(header)

  // ICONDIRENTRY × n
  let offset = dataOffset
  for (const png of pngs) {
    const entry = Buffer.alloc(ENTRY_SIZE)
    entry.writeUInt8(png.width === 256 ? 0 : png.width, 0)
    entry.writeUInt8(png.height === 256 ? 0 : png.height, 1)
    entry.writeUInt8(0, 2) // colorCount
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(png.data.length, 8) // dataSize
    entry.writeUInt32LE(offset, 12) // dataOffset
    buffers.push(entry)
    offset += png.data.length
  }

  // 图像数据
  for (const png of pngs) buffers.push(png.data)

  const ico = Buffer.concat(buffers)
  writeFileSync(outPath, ico)
  console.log(
    `wrote ${outPath} (${ico.length} bytes, ${pngs.length} entries: ${pngs.map((p) => `${p.width}×${p.height}`).join(", ")})`,
  )
}

main()

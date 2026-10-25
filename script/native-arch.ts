import { readFile } from "node:fs/promises"

type Image = {
  readonly offset: number
  readonly format: "PE" | "ELF" | "Mach-O"
  readonly arches: readonly string[]
  // A universal Mach-O ends after its last slice; the thin slices inside it are not separate images.
  readonly end?: number
}

const PE_MACHINES: Record<number, string> = { 0x8664: "x64", 0xaa64: "arm64", 0x014c: "x86", 0x01c4: "arm" }
const ELF_MACHINES: Record<number, string> = { 62: "x64", 183: "arm64", 3: "x86", 40: "arm" }
const MACHO_CPUS: Record<number, string> = { 0x01000007: "x64", 0x0100000c: "arm64", 7: "x86", 12: "arm" }

export namespace NativeArch {
  /** Every PE, ELF and Mach-O image in `bytes`, including the libraries Bun embeds in a compiled executable. */
  export function images(bytes: Buffer) {
    const universal = find(bytes, "\xca\xfe\xba\xbe", fat)
    const thin = find(bytes, "\xcf\xfa\xed\xfe", macho).filter(
      (image) => !universal.some((parent) => image.offset > parent.offset && image.offset < (parent.end ?? 0)),
    )
    return [...find(bytes, "MZ", pe), ...find(bytes, "\x7fELF", elf), ...thin, ...universal].sort(
      (left, right) => left.offset - right.offset,
    )
  }

  /**
   * Fails unless `file` is a native image for `arch` and every image embedded in it targets `arch` too. A
   * wrong-architecture library loads only on the machine that needs it, so it ships unnoticed: 2.0.27's ARM64
   * Windows CLI embedded an x64 rust_pty.dll and could not open a terminal.
   */
  export async function verify(file: string, arch: "x64" | "arm64") {
    const found = images(await readFile(file))
    if (found[0]?.offset !== 0) throw new Error(`${file} is not a native executable or library`)
    const wrong = found.filter((image) => !image.arches.includes(arch))
    if (wrong.length === 0) return
    throw new Error(
      `${file} must contain only ${arch} code, but has ${wrong
        .map((image) => `${image.format} ${image.arches.join("+")} at byte ${image.offset}`)
        .join(", ")}`,
    )
  }

  /** Whether `file` starts with a native image, so a package scan can skip scripts, data and debug symbols. */
  export async function isNative(file: string) {
    const bytes = await readFile(file)
    return images(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).some((image) => image.offset === 0)
  }
}

function find(bytes: Buffer, magic: string, parse: (bytes: Buffer, offset: number) => Image | undefined) {
  const needle = Buffer.from(magic, "latin1")
  const found: Image[] = []
  for (let offset = bytes.indexOf(needle); offset !== -1; offset = bytes.indexOf(needle, offset + 1)) {
    const image = parse(bytes, offset)
    if (image) found.push(image)
  }
  return found
}

function pe(bytes: Buffer, offset: number): Image | undefined {
  if (offset + 0x40 > bytes.length) return
  const header = offset + bytes.readUInt32LE(offset + 0x3c)
  if (header - offset < 0x40 || header - offset > 0x1000 || header + 6 > bytes.length) return
  if (bytes.readUInt32LE(header) !== 0x4550) return
  const machine = bytes.readUInt16LE(header + 4)
  return { offset, format: "PE", arches: [PE_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`] }
}

function elf(bytes: Buffer, offset: number): Image | undefined {
  if (offset + 24 > bytes.length) return
  const elfClass = bytes[offset + 4]
  const data = bytes[offset + 5]
  if ((elfClass !== 1 && elfClass !== 2) || (data !== 1 && data !== 2) || bytes[offset + 6] !== 1) return
  const machine = data === 1 ? bytes.readUInt16LE(offset + 18) : bytes.readUInt16BE(offset + 18)
  const version = data === 1 ? bytes.readUInt32LE(offset + 20) : bytes.readUInt32BE(offset + 20)
  if (version !== 1) return
  return { offset, format: "ELF", arches: [ELF_MACHINES[machine] ?? `machine ${machine}`] }
}

function macho(bytes: Buffer, offset: number): Image | undefined {
  if (offset + 8 > bytes.length) return
  const arch = MACHO_CPUS[bytes.readUInt32LE(offset + 4)]
  if (!arch) return
  return { offset, format: "Mach-O", arches: [arch] }
}

function fat(bytes: Buffer, offset: number): Image | undefined {
  if (offset + 8 > bytes.length) return
  const count = bytes.readUInt32BE(offset + 4)
  // Java class files share this magic; their version field reads as 45 or more here.
  if (count < 1 || count > 8 || offset + 8 + count * 20 > bytes.length) return
  const slices = Array.from({ length: count }, (_, index) => offset + 8 + index * 20)
  const arches = slices.map((slice) => MACHO_CPUS[bytes.readUInt32BE(slice)])
  if (arches.some((arch) => arch === undefined)) return
  return {
    offset,
    format: "Mach-O",
    arches: arches.filter((arch) => arch !== undefined),
    end: offset + Math.max(...slices.map((slice) => bytes.readUInt32BE(slice + 8) + bytes.readUInt32BE(slice + 12))),
  }
}

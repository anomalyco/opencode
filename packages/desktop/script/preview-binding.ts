import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { NativeArch } from "../../../script/native-arch"

export function previewBinding(platform: string, arch: string) {
  if (platform === "win32") return `win32-${arch}-msvc`

  if (platform === "linux") return `linux-${arch}-gnu`

  return `${platform}-${arch}`
}

/** Resolve without executing: a pack host may be building for another OS or CPU. */
export async function verifyPreviewBinding(resources: string, platform: string, arch: "arm64" | "x64") {
  const target = previewBinding(platform, arch)
  const unpacked = path.join(await realpath(resources), "app.asar.unpacked")
  const modules = path.join(unpacked, "node_modules")
  const pkg = `@yuuang/ffi-rs-${target}`
  const expected = path.join(modules, pkg, `ffi-rs.${target}.node`)

  try {
    const main = createRequire(path.join(unpacked, "out/main/index.js"))
    const wrapper = main.resolve("ffi-rs")

    if (wrapper !== path.join(modules, "ffi-rs/index.js") || createRequire(wrapper).resolve(pkg) !== expected)
      throw new Error(`Expected the packaged ffi-rs loader to resolve ${expected}`)
    await NativeArch.verify(expected, arch)
  } catch (cause) {
    throw new Error(`Invalid unpacked preview binding for ${target}: ${expected} (${cause instanceof Error ? cause.message : cause})`, { cause })
  }
}

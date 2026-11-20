import { readFile, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { Schema } from "effect"
import { NativeArch } from "../../../script/native-arch"

export function previewBinding(platform: string, arch: string) {
  if (platform === "win32") return `win32-${arch}-msvc`

  if (platform === "linux") return `linux-${arch}-gnu`

  return `${platform}-${arch}`
}

/**
 * Resolve without executing: a pack host may be building for another OS or CPU. The loader may find its binding beside
 * it or nested under it, as the install laid them out; either way it is unpacked, the target's, and the version the
 * loader declares. Linux names an open file through /proc and loads no binding.
 */
export async function verifyPreviewBinding(resources: string, platform: string, arch: "arm64" | "x64") {
  if (platform === "linux") return
  const target = previewBinding(platform, arch)
  const unpacked = path.join(await realpath(resources), "app.asar.unpacked")
  const pkg = `@yuuang/ffi-rs-${target}`
  const addon = `ffi-rs.${target}.node`
  const inside = (file: string) => file.startsWith(unpacked + path.sep)

  try {
    const wrapper = createRequire(path.join(unpacked, "out/main/index.js")).resolve("ffi-rs")
    const binding = createRequire(wrapper).resolve(pkg)
    const declared = manifest(await readFile(path.join(path.dirname(wrapper), "package.json"), "utf8")).optionalDependencies?.[pkg]
    const version = manifest(await readFile(path.join(path.dirname(binding), "package.json"), "utf8")).version

    if (!inside(wrapper) || !inside(binding) || path.basename(binding) !== addon || !declared || version !== declared)
      throw new Error(`Expected the packaged ffi-rs loader to resolve ${pkg}@${declared} to ${addon} inside ${unpacked}, found ${binding}@${version}`)
    await NativeArch.verify(binding, arch)
  } catch (cause) {
    throw new Error(`Invalid unpacked preview binding for ${target}: ${addon} (${cause instanceof Error ? cause.message : cause})`, { cause })
  }
}

const manifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.optional(Schema.String),
      optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
)

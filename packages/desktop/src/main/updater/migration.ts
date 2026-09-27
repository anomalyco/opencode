import { Option, Schema } from "effect"

const Artifact = Schema.Struct({
  version: Schema.String,
  metadata: Schema.Struct({
    files: Schema.Record(Schema.String, Schema.Struct({ url: Schema.String })),
  }),
})
const decode = Schema.decodeUnknownOption(Artifact)

export function requiresStableMacInstaller(platform: string, channel: string) {
  return platform === "darwin" && channel === "beta"
}

export function stableMacDownload(input: unknown, arch: string) {
  if (arch !== "arm64" && arch !== "x64") return undefined
  const artifact = Option.getOrUndefined(decode(input))
  const file = artifact?.metadata.files[`opencode-desktop-mac-${arch}.dmg`]
  return file && { version: artifact.version, url: file.url }
}

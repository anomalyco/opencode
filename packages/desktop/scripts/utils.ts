import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Option, Schema } from "effect"

const CLI_VERSION = "dev"

const Manifest = Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString }))

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.BOLT_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (raw === "latest") return "prod"

  return "dev"
}

export const CLI_BINARIES: Array<{ target: string; package: string; os: string; cpu: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    package: "@bolt-builder/bolt-cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    package: "@bolt-builder/bolt-cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    package: "@bolt-builder/bolt-cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    package: "@bolt-builder/bolt-cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    package: "@bolt-builder/bolt-cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    package: "@bolt-builder/bolt-cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const CLI_TARGET = process.env.OPENCODE_CLI_TARGET

function nativeTarget() {
  const { platform, arch } = process

  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"

  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"

  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = process.env.OPENCODE_CLI_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.target === target)

  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

export function nodePtyPackage(target?: string) {
  const cli = getCurrentCli(target)

  return `@lydell/node-pty-${cli.os}-${cli.cpu}`
}

export async function downloadCliToResources(version = CLI_VERSION, dest = windowsify("resources/opencode-cli")) {
  const { $ } = await import("bun")
  const cli = getCurrentCli()
  const directory = await mkdtemp(join(tmpdir(), "bolt-cli-"))
  const dest = windowsify("resources/bolt-cli")
  try {
    await $`bun install --no-save --cwd ${directory} ${`${cli.package}@${CLI_VERSION}`} ${`--os=${cli.os}`} ${`--cpu=${cli.cpu}`}`
    await copyFile(join(directory, "node_modules", cli.package, "bin", cli.os === "win32" ? "bolt.exe" : "bolt"), dest)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  console.log(`Copied ${cli.package}@${version} to ${dest}`)
}

export async function copyBuiltCliToResources(root: string, dest = windowsify("resources/opencode-cli")) {
  const cli = getCurrentCli()
  const directory = cli.package.replace("@opencode/", "")
  await copyCliToResources(join(root, directory), dest)
}

// The package directory is an npm package: its package.json version is the string the executable
// prints for --version. Writing it next to the executable spares the desktop a ~400 ms spawn of the
// 200 MB binary on first launch.
async function copyCliToResources(pkg: string, dest: string) {
  const cli = getCurrentCli()
  await copyFile(join(pkg, "bin", cli.os === "win32" ? "opencode.exe" : "opencode"), dest)
  await prepareCli(dest)

  const manifest = Option.getOrUndefined(
    Schema.decodeUnknownOption(Manifest)(await Bun.file(join(pkg, "package.json")).text()),
  )

  if (!manifest) throw new Error(`Bundled CLI package has no version: ${pkg}`)
  await Bun.write(versionFile(dest), manifest.version)
}

export function versionFile(cli: string) {
  return join(dirname(cli), "opencode-cli.version")
}

async function prepareCli(dest: string) {
  const { $ } = await import("bun")

  if (process.platform !== "win32") await chmod(dest, 0o755)

  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }

  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path

  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}

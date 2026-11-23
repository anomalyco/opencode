// Installs OpenTUI's native library for the client's pin from the OpenTUI release zip: the header, the static archive
// opentui-sys links, and every licence and source-notice file of the zip (under `licenses/`). The zip is checked
// against the sha256 in `releases` below and its `opentui.h` against the release's header hash, which opentui-sys's
// build script checks again against its bindings. The release zips carry no GitHub attestation, so this table is the
// control: a re-pin adds the release's rows from `gh release view <tag> -R anomalyco/opentui --json assets`.
//
// Usage: bun run script/opentui-native.ts [--target <rust-target>] [--dest <dir>] [--quiet]
//   The tag is `v` and the exact crates.io version of the `opentui` dependency in Cargo.toml
//   (`version = "=X.Y.Z"`). Without `--target` it installs the
//   host's library into the directory `.cargo/config.toml` names (`.opentui/<tag>/host`); with `--target` into
//   `.opentui/<tag>/<target>`, unless `--dest` names another. It prints the directory, for `OPENTUI_LIB_DIR`.
//   Downloaded zips are kept in `$XDG_CACHE_HOME/opencode/opentui-native`, so a new worktree needs no network.
//   `--quiet` is the check `bun run cargo` runs first: silent when the directory is current, when `OPENTUI_LIB_DIR`
//   is set in the shell, or when the pin is no release (a `git` or `path` spec, which brings its own directory).
//
// Needs only Bun: the zip is read here, so it runs the same on Linux, macOS and Windows.
import { createHash } from "node:crypto"
import { mkdir, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { unzip } from "./zip"

// The OpenTUI releases the client can pin: the commit the tag names, the FNV-1a 64 of its `opentui.h`, and the sha256
// of `opentui-native-<tag>-<platform>.zip` for each platform.
const releases: Record<string, { commit: string; header: string; zips: Record<string, string> }> = {
  "v0.9.8": {
    commit: "07037a67fca5f50509c80feebf39d4f26847be1f",
    header: "0x99dd2d0018a6caa3",
    zips: {
      "darwin-arm64": "e810525073a1bc13d9dc3fd6f604250bbfb58664e3518cc51ea017c35c5b7e36",
      "darwin-x64": "712a32ea5d978b2be36604e2a9e05925017f9d4981347fa0b5fa6a3f0b3f61e0",
      "linux-arm64": "87950df52555712bbf88fd043be201ec5e5bfbd983e7c930cd987b7bffb38e44",
      "linux-arm64-musl": "74a303c90c30cd7bb38b967d946c87f39f7a074470b73d6ad22154cbec482105",
      "linux-x64": "cd20540a20cc55f2bb7ff15abcc58bc9972959818bbd968f0a0d58a785219fbd",
      "linux-x64-musl": "4f6221bc24621a4897076bc4bfee3ff271c91a9c529efe8705bc6b6b76145d5a",
      "windows-arm64": "bc3159fee6132330dc5068baf6b32822968b5d38ddd91aaff440dd958dbbeb46",
      "windows-x64": "e538cfc8414c759a873577f31ba1900ebf4b0670cd6c9dec867fef00d5f0e9e0",
    },
  },
}

// Each Rust target, its zip's platform, and the static archive opentui-sys links with its default `static` feature.
const targets: Record<string, { platform: string; archive: string }> = {
  "x86_64-unknown-linux-gnu": { platform: "linux-x64", archive: "libopentui.a" },
  "aarch64-unknown-linux-gnu": { platform: "linux-arm64", archive: "libopentui.a" },
  "x86_64-unknown-linux-musl": { platform: "linux-x64-musl", archive: "libopentui.a" },
  "aarch64-unknown-linux-musl": { platform: "linux-arm64-musl", archive: "libopentui.a" },
  "x86_64-apple-darwin": { platform: "darwin-x64", archive: "libopentui.a" },
  "aarch64-apple-darwin": { platform: "darwin-arm64", archive: "libopentui.a" },
  "x86_64-pc-windows-msvc": { platform: "windows-x64", archive: "opentui-static.lib" },
  "aarch64-pc-windows-msvc": { platform: "windows-arm64", archive: "opentui-static.lib" },
}

const root = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const quiet = args.includes("--quiet")
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

if (quiet && process.env.OPENTUI_LIB_DIR) process.exit(0)
const dependency = (await Bun.file(path.join(root, "Cargo.toml")).text()).match(/^opentui = \{[^}]*\}/m)?.[0] ?? ""
const version = /\b(git|path) = /.test(dependency) ? undefined : dependency.match(/\bversion = "=([^"]+)"/)?.[1]
if (!version && quiet) process.exit(0)
const tag = `v${must(
  version,
  "the opentui dependency in Cargo.toml pins no crates.io release (`version = \"=X.Y.Z\"`); build the library for its rev or path",
)}`
const release = must(releases[tag], `no sha256 table for ${tag}; add its rows to script/opentui-native.ts`)
const target = option("--target") ?? host()
const spec = must(targets[target], `no OpenTUI release zip for ${target}; it has ${Object.keys(targets).join(", ")}`)
const dest = path.resolve(
  option("--dest") ?? (option("--target") ? path.join(root, ".opentui", tag, target) : await configured()),
)
const zip = `opentui-native-${tag}-${spec.platform}.zip`
const sha256 = release.zips[spec.platform]

if (!(await current())) await install()
if (!quiet) console.log(dest)

/** Whether `dest` holds this release's files for the target: its STAMP names them and the header still hashes right. */
async function current() {
  const stamp = Bun.file(path.join(dest, "STAMP.json"))
  if (!(await stamp.exists())) return false
  const known = await stamp.json()
  if (known.tag !== tag || known.target !== target || known.sha256 !== sha256) return false
  if (!(await Bun.file(path.join(dest, spec.archive)).exists())) return false
  return fnv1a64(await Bun.file(path.join(dest, "opentui.h")).bytes()) === release.header
}

async function install() {
  const bytes = await download()
  const files = unzip(bytes, zip, fail)
  const header = files.get("opentui.h")
  if (!header || fnv1a64(header) !== release.header) fail(`${zip}'s opentui.h does not hash to ${release.header}`)
  if (!files.has(spec.archive)) fail(`${zip} has no ${spec.archive}`)
  const notices = [...files.keys()].filter((name) =>
    /^(LICENSE|COPYING|NOTICE|AUTHORS|PATENTS)|-SOURCE\.md$/.test(name),
  )
  if (!notices.includes("LICENSE")) fail(`${zip} has no LICENSE (OpenTUI's own)`)
  // Written beside `dest` and renamed into place, so a build never sees half a directory.
  const staged = `${dest}.${process.pid}.tmp`
  await rm(staged, { recursive: true, force: true })
  await mkdir(path.join(staged, "licenses"), { recursive: true })
  for (const name of ["opentui.h", spec.archive]) await Bun.write(path.join(staged, name), files.get(name)!)
  for (const name of notices) await Bun.write(path.join(staged, "licenses", name), files.get(name)!)
  await Bun.write(
    path.join(staged, "STAMP.json"),
    JSON.stringify({ tag, commit: release.commit, target, zip, sha256 }, null, 2) + "\n",
  )
  await rm(dest, { recursive: true, force: true })
  await rename(staged, dest).catch(async (error) => {
    // Another build installed the same files meanwhile.
    await rm(staged, { recursive: true, force: true })
    if (!(await current())) throw error
  })
  console.error(`opentui-native: installed ${zip} (${target}) into ${path.relative(process.cwd(), dest) || "."}`)
}

/** The zip, from the cache or the release, checked against the table. */
async function download() {
  const cache = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "opencode", "opentui-native")
  const cached = Bun.file(path.join(cache, zip))
  if ((await cached.exists()) && digest(await cached.bytes()) === sha256) return cached.bytes()
  const url = `https://github.com/anomalyco/opentui/releases/download/${tag}/${zip}`
  console.error(`opentui-native: downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) fail(`${url}: ${response.status} ${response.statusText}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const got = digest(bytes)
  if (got !== sha256) fail(`${zip} has sha256 ${got}, not ${sha256}`)
  await mkdir(cache, { recursive: true })
  const partial = path.join(cache, `${zip}.${process.pid}.tmp`)
  await Bun.write(partial, bytes)
  await rename(partial, cached.name!)
  return bytes
}

/** The directory `.cargo/config.toml` names for the host's library, which must be this tag's. */
async function configured() {
  const config = await Bun.file(path.join(root, ".cargo", "config.toml")).text()
  const value = config.match(/^OPENTUI_LIB_DIR = \{ value = "([^"]+)", relative = true/m)?.[1]
  if (!value) fail(".cargo/config.toml names no relative OPENTUI_LIB_DIR")
  if (!value.split("/").includes(tag)) fail(`.cargo/config.toml names ${value}, but Cargo.toml pins ${tag}`)
  return path.join(root, value)
}

function host() {
  const output = Bun.spawnSync([process.env.RUSTC ?? "rustc", "-vV"]).stdout.toString()
  const found = output.match(/^host: (\S+)/m)?.[1]
  if (!found) fail("cannot tell the host target from `rustc -vV`; pass --target")
  return found
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

// Must match fnv1a64 in OpenTUI's packages/core/scripts/native-abi-rust.ts, which writes the bindings' hash.
function fnv1a64(bytes: Uint8Array) {
  const hash = bytes.reduce(
    (hash, byte) => BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n),
    0xcbf29ce484222325n,
  )
  return `0x${hash.toString(16).padStart(16, "0")}`
}

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) fail(message)
  return value
}

function fail(message: string): never {
  console.error(`opentui-native: ${message}`)
  process.exit(1)
}

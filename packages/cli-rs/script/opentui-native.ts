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
  "v0.9.6": {
    commit: "fdcfb13af4c04e21d0d1358724b5866e9b96342c",
    header: "0x99dd2d0018a6caa3",
    zips: {
      "darwin-arm64": "504b27da0b2133bf3dba03ab25bc6649dcb8a18982261da26b01a775ec3a4220",
      "darwin-x64": "f9d1696d3828820410e42bffe792c00331cad2edcdf225ae84043a1d3d7110fe",
      "linux-arm64": "ecbafb8f8db975ba6abeecdb54dc5d42687e2575b8d14289541f2d0a17afd6f4",
      "linux-arm64-musl": "e31ce83eee98d78a33a06029f6248181286e93e311e54ff7472af29ad4f785af",
      "linux-x64": "635b5837b38842d932c158b508c15614da8b5be26607e1d02dc880efb34cffc8",
      "linux-x64-musl": "a2c92ca9ee59a1c4dc49a541252634d737b552b315afb9330bf34fa2a168c6b5",
      "windows-arm64": "857a1a991f61c15fd48bc9d7bc2d50cdb40db06ecddc2a9d03ca9c9d5a1cb662",
      "windows-x64": "687acfe73c6c5ef51c0c44449e80a33b232b59e2eed18ec7b98562b7648f54d0",
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

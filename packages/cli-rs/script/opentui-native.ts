// Installs OpenTUI's native library for the client's pin from the OpenTUI release zip: the header, the static archive
// opentui-sys links, and every licence and source-notice file of the zip (under `licenses/`). The zip is checked
// against the sha256 in `releases` below and its `opentui.h` against the release's header hash, which opentui-sys's
// build script checks again against its bindings. The release zips carry no GitHub attestation, so this table is the
// control: a re-pin adds the release's rows from `gh release view <tag> -R anomalyco/opentui --json assets`.
//
// Usage: bun run script/opentui-native.ts [--target <rust-target>] [--dest <dir>] [--quiet]
//   The tag comes from the `opentui` dependency in Cargo.toml (`tag = "vX.Y.Z"`). Without `--target` it installs the
//   host's library into the directory `.cargo/config.toml` names
//   (`.opentui/<tag>/host-fill-with-bun-run-opentui-native`); with `--target` into `.opentui/<tag>/<target>`, unless
//   `--dest` names another. It prints the directory, for `OPENTUI_LIB_DIR`.
//   Downloaded zips are kept in `$XDG_CACHE_HOME/opencode/opentui-native`, so a new worktree needs no network.
//   `--quiet` is the check `bun run cargo` runs first: silent when the directory is current, when `OPENTUI_LIB_DIR`
//   is set in the shell, or when the pin is no release (a `rev` or `path`, which brings its own directory).
//
// Needs only Bun: the zip is read here, so it runs the same on Linux, macOS and Windows.
import { createHash } from "node:crypto"
import { mkdir, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { inflateRawSync } from "node:zlib"

// The OpenTUI releases the client can pin: the commit the tag names, the FNV-1a 64 of its `opentui.h`, and the sha256
// of `opentui-native-<tag>-<platform>.zip` for each platform.
const releases: Record<string, { commit: string; header: string; zips: Record<string, string> }> = {
  "v0.9.1": {
    commit: "a865cdc28617234da656725c539cb0356df2b41d",
    header: "0x99dd2d0018a6caa3",
    zips: {
      "darwin-arm64": "81f4ac6a1b85c0722e37223d713685e8f9824639b5675c6673c33eb56b9eea77",
      "darwin-x64": "2c1f94590115f3a27e9ab2c5a1c013dcdb99de03497c2e690a6363dffe14dc26",
      "linux-arm64": "0fc085a5b1162730ab04c1846ba938fe86f10e4c51772a50d1a1ebef877825b3",
      "linux-arm64-musl": "13546071921b5c084f3bc15b0099bf0dd8364a5e4bb62a8ca193c861edc069d2",
      "linux-x64": "c445a090f587ab435c1658f84047d212682905e8b8044140f6d8202294eebd0a",
      "linux-x64-musl": "c34cc4fe28e99cb04c401932c3c5c41080c6821ab9eb08a5c19326a44ada9dfc",
      "windows-arm64": "3bdc98940e039fadd81b1fa7067a62d8bbc794ed1a99301c42452adaa1e2ed5a",
      "windows-x64": "187cda48bc2669ae4bc0c3b2dd31776dac6330e4203d5e99a641db1a1acccf17",
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
const pinned = (await Bun.file(path.join(root, "Cargo.toml")).text()).match(/^opentui = \{[^}]*\btag = "([^"]+)"/m)?.[1]
if (!pinned && quiet) process.exit(0)
const tag = must(
  pinned,
  "the opentui dependency in Cargo.toml names no release tag; build the library for its rev or path",
)
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
  const files = unzip(bytes)
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

/** The files of a flat zip (stored or deflated), by name, read from its central directory. */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = Array.from({ length: Math.min(bytes.length - 21, 65_558) }, (_, back) => bytes.length - 22 - back).find(
    (at) => at >= 0 && view.getUint32(at, true) === 0x06054b50,
  )
  if (end === undefined) fail(`${zip} is not a zip`)
  const count = view.getUint16(end + 10, true)
  const files = new Map<string, Uint8Array>()
  let entry = view.getUint32(end + 16, true)
  for (let index = 0; index < count; index++) {
    if (view.getUint32(entry, true) !== 0x02014b50) fail(`${zip}: a broken central directory`)
    const method = view.getUint16(entry + 10, true)
    const size = view.getUint32(entry + 20, true)
    const length = view.getUint32(entry + 24, true)
    const name = new TextDecoder().decode(bytes.subarray(entry + 46, entry + 46 + view.getUint16(entry + 28, true)))
    const local = view.getUint32(entry + 42, true)
    entry += 46 + view.getUint16(entry + 28, true) + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true)
    if (name.endsWith("/")) continue
    if (/[\\/]|^\.\.?$/.test(name)) fail(`${zip}: an entry outside the directory: ${name}`)
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    const content = method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data)) : undefined
    if (!content || content.length !== length) fail(`${zip}: cannot read ${name} (method ${method})`)
    files.set(name, content)
  }
  return files
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

// Type-checks every Luau plugin in packages/cli-rs (a directory with a plugin.toml and .luau files) with
// `luau-analyze` at the runtime's Luau release, the new solver, and `--formatter=gnu` (`plain` always exits 0). Each
// plugin is one run over its files by absolute path: a module given by a relative path and also required is checked
// twice. Each plugin's nearest `.luaurc` must say `"languageMode": "strict"` and alias `opencode` to the generated stub
// (crates/plugin/src/luau/opencode), which types `require("@opencode/plugin")`.
//
// The release is the one the runtime vendors, read from Cargo.lock (`luau0-src 0.22.0+luau740` is 0.740), so the
// analyzer moves with a Luau bump. It comes from Luau's release zip, checked against the sha256 in `releases` below,
// as opentui-native.ts checks OpenTUI's: a release binary rather than a build, one download and no C++ build. A
// release with no row fails; add its rows from `gh release view <release> -R luau-lang/luau --json assets`. Zips are
// kept in `$XDG_CACHE_HOME/opencode/luau`.
//
// Usage: bun run script/check-luau-types.ts
import { createHash } from "node:crypto"
import { chmod, mkdir, rename } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { unzip } from "./zip"

// The sha256 of each Luau release's zips. Luau ships none for Linux arm64 or Windows arm64.
const releases: Record<string, Record<"ubuntu" | "macos" | "windows", string>> = {
  "0.740": {
    ubuntu: "7d4035db01816f977f6e4c42e3d5e8ef4235d95e9afe63a3c38905b42dde60f2",
    macos: "8414763743116cbc2533ee7c932d41ba66bd25ea7c2353bc7eed2934b60b6715",
    windows: "be676d9a1092b3d5ee36be5f5f11e2af1976911c32f5644a052548dc7c66bb9c",
  },
  "0.747": {
    ubuntu: "6a740240248e872815865a2cb03b0c327f24939478f1d0081a0540cdfd77fdaa",
    macos: "5e140ae70f14509504ce015e33894dfd56872c9170040c68373cbe1d85fa7877",
    windows: "16bbd26575e9a6a3ecd2bd5fc772a81f3232520b56a40a86f2b47fec576d7cc7",
  },
}
// The zip each platform runs, and the analyzer in it.
const platforms: Record<string, { zip: "ubuntu" | "macos" | "windows"; binary: string }> = {
  "linux-x64": { zip: "ubuntu", binary: "luau-analyze" },
  "darwin-x64": { zip: "macos", binary: "luau-analyze" },
  "darwin-arm64": { zip: "macos", binary: "luau-analyze" },
  "win32-x64": { zip: "windows", binary: "luau-analyze.exe" },
}

const root = path.resolve(import.meta.dir, "..")
const stub = path.join(root, "crates", "plugin", "src", "luau", "opencode")
const vendored = (await Bun.file(path.join(root, "Cargo.lock")).text()).match(
  /^name = "luau0-src"\nversion = "[^"+]*\+luau(\d+)"/m,
)?.[1]
const release = `0.${vendored ?? fail("Cargo.lock has no luau0-src <version>+luau<release>")}`
const platform = `${process.platform}-${process.arch}`
const kind = platforms[platform] ?? fail(`Luau ships no luau-analyze for ${platform}`)
const sha256 =
  releases[release]?.[kind.zip] ?? fail(`no sha256 for Luau ${release}; add its rows to ${import.meta.file}`)
const spec = { zip: `luau-${kind.zip}.zip`, sha256, binary: kind.binary }
const cache = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "opencode", "luau")
const analyzer = await install()

const plugins = Array.from(new Bun.Glob("**/plugin.toml").scanSync({ cwd: root }))
  .filter((file) => !/^(target|node_modules|\.opentui)\//.test(file) && !file.includes("/node_modules/"))
  .map((file) => path.join(root, path.dirname(file)))
  .sort()
const results = await Promise.all(plugins.map(check))
const errors = results.reduce((sum, count) => sum + count, 0)
const checked = results.filter((count) => count >= 0).length
console.log(`check-luau-types: ${checked} plugin(s), luau-analyze ${release}, ${errors} error(s)`)
if (errors > 0) process.exit(1)

/** Analyzes one plugin directory and returns its error count; -1 when it has no .luau files. */
async function check(dir: string) {
  const files = Array.from(new Bun.Glob("**/*.luau").scanSync({ cwd: dir }))
    .map((file) => path.join(dir, file))
    .sort()
  if (files.length === 0) return -1
  const config = await luaurc(dir)
  if (config.problem) {
    console.error(`${path.relative(root, dir)}: ${config.problem}`)
    return 1
  }
  const proc = Bun.spawnSync([analyzer, "--formatter=gnu", "--solver=new", ...files], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = proc.stdout.toString() + proc.stderr.toString()
  if (output.trim()) console.error(output.trimEnd())
  const count = output.split("\n").filter((line) => /^\S.*:\d+\.\d+-\d+\.\d+: /.test(line)).length
  // Exits non-zero with errors; a crash or an unparsable report still counts as one.
  return proc.exitCode === 0 ? count : Math.max(count, 1)
}

/** What is wrong with the nearest `.luaurc` above `dir` (inside packages/cli-rs), if anything. */
async function luaurc(dir: string): Promise<{ problem?: string }> {
  for (let at = dir; at.startsWith(root); at = path.dirname(at)) {
    const file = Bun.file(path.join(at, ".luaurc"))
    if (!(await file.exists())) continue
    const config = await file.json()
    const name = path.relative(root, file.name!)
    if (config.languageMode !== "strict") return { problem: `${name} does not say "languageMode": "strict"` }
    const alias = config.aliases?.opencode
    if (typeof alias !== "string" || path.resolve(at, alias) !== stub)
      return { problem: `${name} does not alias opencode to ${path.relative(at, stub)}` }
    return {}
  }
  return { problem: `no .luaurc above it aliases opencode to ${path.relative(root, stub)}` }
}

/** The analyzer, extracted from the release zip once. */
async function install() {
  const dir = path.join(cache, `${release}-${platform}`)
  const binary = path.join(dir, spec.binary)
  if (await Bun.file(binary).exists()) return binary
  const files = unzip(await download(), spec.zip, fail)
  const bytes = files.get(spec.binary) ?? fail(`${spec.zip} has no ${spec.binary}`)
  await mkdir(dir, { recursive: true })
  const partial = `${binary}.${process.pid}.tmp`
  await Bun.write(partial, bytes)
  await chmod(partial, 0o755)
  await rename(partial, binary)
  console.error(`check-luau-types: installed luau-analyze ${release} into ${dir}`)
  return binary
}

/** The release zip, from the cache or GitHub, checked against the table. */
async function download() {
  const cached = Bun.file(path.join(cache, `${release}-${spec.zip}`))
  if ((await cached.exists()) && digest(await cached.bytes()) === spec.sha256) return cached.bytes()
  const url = `https://github.com/luau-lang/luau/releases/download/${release}/${spec.zip}`
  console.error(`check-luau-types: downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) fail(`${url}: ${response.status} ${response.statusText}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const got = digest(bytes)
  if (got !== spec.sha256) fail(`${spec.zip} has sha256 ${got}, not ${spec.sha256}`)
  await mkdir(cache, { recursive: true })
  const partial = `${cached.name}.${process.pid}.tmp`
  await Bun.write(partial, bytes)
  await rename(partial, cached.name!)
  return bytes
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function fail(message: string): never {
  console.error(`check-luau-types: ${message}`)
  process.exit(1)
}

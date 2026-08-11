import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

// Release inputs are OPVIERA_*. The upstream OPENCODE_* names are still accepted as a fallback so
// an existing pipeline or a half-updated shell keeps working rather than silently building the
// wrong version.
const pick = (name: string) => process.env[`OPVIERA_${name}`] ?? process.env[`OPENCODE_${name}`]

const env = {
  OPENCODE_CHANNEL: pick("CHANNEL"),
  OPENCODE_BUMP: pick("BUMP"),
  OPENCODE_VERSION: pick("VERSION"),
  OPENCODE_RELEASE: pick("RELEASE"),
}
const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  // Upstream derived the next release version from `opencode-ai` on npm. Opviera must never do
  // that — it would inherit opencode's version lineage and publish, say, v1.18.17 as our first
  // release. Until an `opviera` npm package exists to bump from, a real release states its version.
  throw new Error(
    "OPVIERA_VERSION is required for a release build (e.g. OPVIERA_VERSION=0.1.0). " +
      "Preview builds off a non-`latest` channel get an automatic 0.0.0-<channel>-<timestamp> version.",
  )
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))

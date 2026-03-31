import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const appPkgPath = path.resolve(import.meta.dir, "../../opencode/package.json")
const appPkg = await Bun.file(appPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const base = (() => {
  const value = typeof appPkg.version === "string" ? appPkg.version.trim() : ""
  return semver.valid(value) ?? "0.0.0"
})()
const explicit = (() => {
  const value = env.OPENCODE_VERSION?.trim()
  if (!value) return
  return semver.valid(value.replace(/^v(?=\d)/, "")) ?? undefined
})()
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
const tag = (value: string) => {
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return clean || "dev"
}
const preview = (value: string, channel: string) => {
  const parsed = semver.parse(value)
  if (!parsed) return `0.0.0-${tag(channel)}.${stamp()}`
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-${tag(channel)}.${stamp()}`
}

const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (explicit && !semver.prerelease(explicit)) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (explicit) return explicit
  if (IS_PREVIEW) return preview(base, CHANNEL)
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.OPENCODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
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

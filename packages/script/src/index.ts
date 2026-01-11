import { $ } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

if (process.versions.bun !== expectedBunVersion) {
  throw new Error(`This script requires bun@${expectedBunVersion}, but you are using bun@${process.versions.bun}`)
}

const env = {
  CRAZYCODE_CHANNEL: process.env["CRAZYCODE_CHANNEL"],
  CRAZYCODE_BUMP: process.env["CRAZYCODE_BUMP"],
  CRAZYCODE_VERSION: process.env["CRAZYCODE_VERSION"],
}
const CHANNEL = await (async () => {
  if (env.CRAZYCODE_CHANNEL) return env.CRAZYCODE_CHANNEL
  if (env.CRAZYCODE_BUMP) return "latest"
  if (env.CRAZYCODE_VERSION && !env.CRAZYCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.CRAZYCODE_VERSION) return env.CRAZYCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/crazycode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.CRAZYCODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

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
}
console.log(`crazycode script`, JSON.stringify(Script, null, 2))

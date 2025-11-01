import { $ } from "bun"

const bunVersionRequired = await (async () => {
  const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).json()
  const packageManager = packageJson.packageManager
  if (!packageManager || !packageManager.startsWith("bun@")) {
    throw new Error("packageManager field must specify bun version (e.g., 'bun@1.3.0')")
  }
  return packageManager.slice(4)
})()

if (process.versions.bun !== bunVersionRequired) {
  throw new Error(`This script requires bun@${bunVersionRequired}`)
}

const CHANNEL =
  process.env["OPENCODE_CHANNEL"] ??
  (await $`git branch --show-current`.text().then((x) => x.trim()))
const IS_PREVIEW = CHANNEL !== "latest"
const VERSION = await (async () => {
  if (IS_PREVIEW)
    return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = process.env["OPENCODE_BUMP"]?.toLowerCase()
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
console.log(`opencode script`, JSON.stringify(Script, null, 2))

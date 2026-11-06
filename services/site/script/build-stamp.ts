// Writes src/lib/build-stamp.json, the view-source comment's build line (src/lib/source-logo.ts):
// the release version from package.json (the release workflow syncs it), the short commit
// (GITHUB_SHA in the deploy workflow, else the local HEAD) and the UTC build date, or "dev" with --dev,
// and a build id unique to this build.
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const pkg = await Bun.file(path.join(root, "package.json")).json()
const sha =
  process.env.GITHUB_SHA || Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim()
const stamp = {
  version: pkg.version,
  commit: sha.slice(0, 7) || "unknown",
  date: process.argv.includes("--dev") ? "dev" : new Date().toISOString().slice(0, 10),
  // Unique per build: part of the Worker's HTML cache key (lib/html-cache.ts), so a deploy never
  // serves pages cached by the previous one.
  build: `${sha.slice(0, 7) || "unknown"}-${Date.now().toString(36)}`,
}
await Bun.write(path.join(root, "src/lib/build-stamp.json"), JSON.stringify(stamp) + "\n")
console.log(`build stamp: v${stamp.version} · ${stamp.commit} · ${stamp.date}`)

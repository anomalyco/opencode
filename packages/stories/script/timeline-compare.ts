#!/usr/bin/env bun
// Compares the session timeline in two builds side by side: this checkout (head) and another git ref (base), each in
// its own stories server, driven by one page with the same session, preset and playhead.
//
//   bun packages/stories/script/timeline-compare.ts [--base <ref>] [--port <port>]
//     Starts both servers and opens the compare page. The base defaults to origin/dev; a release tag shows what users
//     have today. Head reloads as you edit; restart to move the base.
//
//   bun packages/stories/script/timeline-compare.ts export <sessionID>
//     Saves one of your sessions, through the installed `opencode`, for the compare page to replay. Exports land in a
//     folder git ignores, since they hold real code and paths.
import { $ } from "bun"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = (await $`git rev-parse --show-toplevel`.cwd(import.meta.dir).text()).trim()
const renderer = "packages/session-ui/src/timeline/timeline-compare-renderer.stories.tsx"
const sessions = path.join(root, "packages/session-ui/src/timeline/compare-sessions")
const args = process.argv.slice(2)

if (args[0] === "export") {
  const id = args[1]

  if (!id) throw new Error("Pass the ID of the session to export")
  await mkdir(sessions, { recursive: true })
  const file = path.join(sessions, `${id}.json`)
  await Bun.write(file, await $`opencode session export ${id}`.text())
  console.log(`Saved ${path.relative(root, file)}. Pick it under Session on the compare page.`)
  process.exit(0)
}

const flag = (name: string) => {
  const index = args.indexOf(`--${name}`)

  return index < 0 ? undefined : args[index + 1]
}

const ref = flag("base") ?? "origin/dev"
const headPort = Number(flag("port") ?? 6120)
const basePort = headPort + 1

// A remote ref moves on the remote; fetch it so the base is what it names now. Offline, the last fetch serves.
if (ref.includes("/")) {
  const [remote, ...branch] = ref.split("/")
  await $`git fetch ${remote} ${branch.join("/")} --quiet`.cwd(root).nothrow()
}

const sha = (await $`git rev-parse ${ref}^{commit}`.cwd(root).text()).trim()
const base = path.join(tmpdir(), "opencode-timeline-compare")

// One reused worktree for every base, checked out fresh each run. The renderer story is copied in, so remove it first:
// a base that has the file itself would refuse a checkout over an untracked copy.
const reused = existsSync(base)

if (reused) {
  await rm(path.join(base, renderer), { force: true })
  await $`git checkout --detach --force ${sha}`.cwd(base).quiet()
}

if (!reused) await $`git worktree add --detach ${base} ${sha}`.cwd(root).quiet()

// Install only when the base's lockfile changed since the last run.
const lock = createHash("sha256")
  .update(await Bun.file(path.join(base, "bun.lock")).text())
  .digest("hex")
const marker = path.join(base, "node_modules/.timeline-compare-lock")

if (!existsSync(marker) || (await Bun.file(marker).text()) !== lock) {
  console.log(`Installing dependencies for ${ref}…`)
  await $`bun install`.cwd(base).quiet()
  await Bun.write(marker, lock)
}

// Head's renderer, so both sides speak the same messages. It uses only what every build has.
await cp(path.join(root, renderer), path.join(base, renderer))

const serve = (cwd: string, port: number, label: string) =>
  Bun.spawn(["bun", "x", "vite", "--port", String(port), "--strictPort"], {
    cwd: path.join(cwd, "packages/stories"),
    stdout: "ignore",
    stderr: "pipe",
    onExit: (_, code) => {
      if (code) console.error(`The ${label} stories server stopped (exit ${code}).`)
    },
  })

const servers = [serve(root, headPort, "head"), serve(base, basePort, "base")]

const stop = () => {
  servers.forEach((server) => server.kill())
  process.exit(0)
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

const ready = async (port: number) => {
  const deadline = Date.now() + 120_000

  while (Date.now() < deadline) {
    const ok = await fetch(`http://localhost:${port}/`).then(
      (response) => response.ok,
      () => false,
    )

    if (ok) return
    await Bun.sleep(500)
  }

  throw new Error(`The stories server on port ${port} did not start`)
}

await Promise.all([ready(headPort), ready(basePort)])

const head = (await $`git branch --show-current`.cwd(root).text()).trim() || "head"

const url = new URL(`http://localhost:${headPort}/`)
url.searchParams.set("id", "timeline-compare--compare")
url.searchParams.set("base", `http://localhost:${basePort}`)
url.searchParams.set("baseLabel", `${ref} (${sha.slice(0, 8)})`)
url.searchParams.set("headLabel", head)

console.log(`Comparing ${ref} with ${head}: ${url}`)
console.log("Press Ctrl+C to stop both servers.")
await $`${process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open"} ${url.toString()}`
  .quiet()
  .nothrow()

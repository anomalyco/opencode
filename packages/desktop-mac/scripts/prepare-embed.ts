#!/usr/bin/env bun
/**
 * 为 YunPat.app 内嵌 project-root 生成最小 monorepo 清单并安装依赖。
 * 由 build-dist.sh 调用。
 */
import { cp, mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"

const scriptDir = path.resolve(import.meta.dir)
const projectRoot = path.resolve(scriptDir, "../../..")
const embedDir = process.argv[2]

if (!embedDir) {
  console.error("usage: prepare-embed.ts <embed-dir>")
  process.exit(1)
}

const embedPackages = [
  "opencode",
  "core",
  "plugin",
  "script",
  "opencode-patent-plugin",
  "professional-router-plugin",
] as const

const rootPkg = await Bun.file(path.join(projectRoot, "package.json")).json()

const embedPkg = {
  name: "yunpat-embed",
  private: true,
  type: "module",
  packageManager: rootPkg.packageManager,
  workspaces: {
    packages: [
      ...embedPackages.map((p) => `packages/${p}`),
      "packages/sdk/js",
    ],
    catalog: rootPkg.workspaces.catalog,
  },
  patchedDependencies: rootPkg.patchedDependencies,
  overrides: rootPkg.overrides,
  trustedDependencies: rootPkg.trustedDependencies,
  scripts: {
    postinstall: "bun run --cwd packages/opencode fix-node-pty",
  },
}

const exclude = new Set([
  "node_modules",
  ".turbo",
  "dist",
  ".artifacts",
  ".next",
  "coverage",
  ".git",
])

async function copyPackage(srcRel: string, destRel: string) {
  const src = path.join(projectRoot, srcRel)
  const dest = path.join(embedDir, destRel)
  await mkdir(path.dirname(dest), { recursive: true })
  const args = [
    "-a",
    ...[...exclude].flatMap((x) => ["--exclude", x]),
    `${src}/`,
    `${dest}/`,
  ]
  const proc = Bun.spawn(["rsync", ...args], { stdout: "inherit", stderr: "inherit" })
  if ((await proc.exited) !== 0) process.exit(1)
  console.log(`  copied ${destRel}`)
}

console.log(`prepare-embed: ${embedDir}`)
await rm(embedDir, { recursive: true, force: true })
await mkdir(embedDir, { recursive: true })

await cp(path.join(projectRoot, "bun.lock"), path.join(embedDir, "bun.lock"))
const patches = path.join(projectRoot, "patches")
try {
  await stat(patches)
  await cp(patches, path.join(embedDir, "patches"), { recursive: true })
} catch {
  // optional
}

await mkdir(path.join(embedDir, "packages"), { recursive: true })
for (const pkg of embedPackages) {
  await copyPackage(`packages/${pkg}`, `packages/${pkg}`)
}
await copyPackage("packages/sdk/js", "packages/sdk/js")

try {
  await stat(path.join(projectRoot, ".opencode"))
  const ocDest = path.join(embedDir, ".opencode")
  await mkdir(ocDest, { recursive: true })
  for (const dir of ["plugin", "plugins", "skills", "agent"] as const) {
    const src = path.join(projectRoot, ".opencode", dir)
    try {
      await stat(src)
      await cp(src, path.join(ocDest, dir), { recursive: true })
    } catch {
      // optional dir
    }
  }
  const ocPkg = path.join(projectRoot, ".opencode/package.json")
  if (await Bun.file(ocPkg).exists()) {
    await cp(ocPkg, path.join(ocDest, "package.json"))
  }
} catch {
  // optional
}

await Bun.write(path.join(embedDir, "package.json"), JSON.stringify(embedPkg, null, 2) + "\n")

const embeddedBun = process.env.EMBEDDED_BUN
const bun = embeddedBun && (await Bun.file(embeddedBun).exists()) ? embeddedBun : "bun"

console.log(`  running ${bun} install in embed root...`)
const install = Bun.spawn([bun, "install", "--frozen-lockfile"], {
  cwd: embedDir,
  stdout: "inherit",
  stderr: "inherit",
})

const code = await install.exited
if (code !== 0) {
  console.warn("  frozen lockfile install failed, retrying without --frozen-lockfile...")
  const retry = Bun.spawn([bun, "install"], {
    cwd: embedDir,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await retry.exited) !== 0) process.exit(1)
}

// 确认桌面 sidecar 入口可加载（不启动长期服务）
const serveEntry = path.join(embedDir, "packages/opencode/src/desktop-serve.ts")
const probe = Bun.spawn([bun, "run", "--conditions=browser", serveEntry, "--help"], {
  cwd: embedDir,
  stdout: "pipe",
  stderr: "pipe",
})
const probeCode = await probe.exited
if (probeCode !== 0) {
  const err = await new Response(probe.stderr).text()
  console.error("prepare-embed: desktop-serve --help failed:\n", err)
  process.exit(1)
}

console.log("prepare-embed: done")

#!/usr/bin/env bun
/**
 * 为 YunPat.app 准备最小化的 sidecar 运行时
 * 
 * 策略:
 * 1. bun build desktop-serve.ts → 单文件 JS bundle（外部化 native/wasm deps）
 * 2. 生成最小 package.json（仅 native/wasm 依赖）
 * 3. bun install --production 安装运行时依赖
 * 4. 复制 .opencode 配置
 * 
 * 体积预期: ~200MB（bun bundle ~20MB + native deps ~150MB + config）
 */
import { cp, mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"

const scriptDir = path.resolve(import.meta.dir)
const projectRoot = path.resolve(scriptDir, "../../..")
const embedDir = process.argv[2]

if (!embedDir) {
  console.error("usage: prepare-embed.ts <embed-dir>")
  process.exit(1)
}

const embeddedBun = process.env.EMBEDDED_BUN
const bun = embeddedBun && (await Bun.file(embeddedBun).exists()) ? embeddedBun : "bun"

console.log(`prepare-embed: ${embedDir}`)
await rm(embedDir, { recursive: true, force: true })
await mkdir(embedDir, { recursive: true })

// ============================================================
// Step 1: Build desktop-serve.ts into standalone bundle
// ============================================================
console.log("[1/5] Building sidecar bundle...")

const buildResult = await Bun.build({
  entrypoints: [path.join(projectRoot, "packages/opencode/src/desktop-serve.ts")],
  target: "bun",
  outdir: embedDir,
  naming: "sidecar.js",
  external: [
    "@lydell/node-pty",
    "@lydell/node-pty-darwin-arm64",
    "@lydell/node-pty-darwin-x64",
    "@lydell/node-pty-linux-arm64",
    "@lydell/node-pty-linux-x64",
    "@lydell/node-pty-win32-arm64",
    "@lydell/node-pty-win32-x64",
    "@parcel/watcher",
    "@parcel/watcher-darwin-arm64",
    "@parcel/watcher-darwin-x64",
    "tree-sitter",
    "tree-sitter-bash",
    "tree-sitter-powershell",
    "web-tree-sitter",
    "mammoth",
    "pdf-parse",
    "*.node",
  ],
  splitting: false,
  minify: true,
})

if (!buildResult.success) {
  for (const log of buildResult.logs) console.error(log)
  process.exit(1)
}

const bundleSize = (await stat(path.join(embedDir, "sidecar.js"))).size
console.log(`  sidecar.js: ${(bundleSize / 1024 / 1024).toFixed(1)} MB`)

// ============================================================
// Step 2: Generate minimal package.json
// ============================================================
console.log("[2/5] Generating minimal manifest...")

const rootPkg = await Bun.file(path.join(projectRoot, "package.json")).json() as Record<string, any>

const minimalPkg = {
  name: "yunpat-sidecar",
  private: true,
  type: "module",
  // Only native/wasm deps needed at runtime
  dependencies: {
    "@lydell/node-pty": rootPkg.workspaces?.catalog?.["@lydell/node-pty"] ?? "*",
    "@parcel/watcher": "^2",
    "tree-sitter-bash": "*",
    "tree-sitter-powershell": "*",
    "web-tree-sitter": "*",
  },
  optionalDependencies: {
    "@lydell/node-pty-darwin-arm64": rootPkg.workspaces?.catalog?.["@lydell/node-pty"] ?? "*",
    "@lydell/node-pty-darwin-x64": rootPkg.workspaces?.catalog?.["@lydell/node-pty"] ?? "*",
    "@parcel/watcher-darwin-arm64": "2.5.1",
    "@parcel/watcher-darwin-x64": "2.5.1",
  },
  trustedDependencies: ["@lydell/node-pty", "@parcel/watcher", "tree-sitter", "tree-sitter-bash", "tree-sitter-powershell", "web-tree-sitter"],
}

await Bun.write(path.join(embedDir, "package.json"), JSON.stringify(minimalPkg, null, 2) + "\n")

// ============================================================
// Step 3: Install runtime deps
// ============================================================
console.log("[3/5] Installing runtime dependencies...")

const install = Bun.spawn([bun, "install", "--production"], {
  cwd: embedDir,
  stdout: "inherit",
  stderr: "inherit",
})
if ((await install.exited) !== 0) process.exit(1)

// ============================================================
// Step 4: Copy .opencode config
// ============================================================
console.log("[4/5] Copying .opencode config...")

const ocDest = path.join(embedDir, ".opencode")
await mkdir(ocDest, { recursive: true })

try {
  const srcOc = path.join(projectRoot, ".opencode")
  for (const dir of ["plugin", "plugins", "skills", "agent"] as const) {
    const src = path.join(srcOc, dir)
    try {
      await stat(src)
      await cp(src, path.join(ocDest, dir), { recursive: true })
    } catch { /* optional */ }
  }
  // Copy opencode.jsonc if exists
  const configFile = path.join(srcOc, "opencode.jsonc")
  if (await Bun.file(configFile).exists()) {
    await cp(configFile, path.join(ocDest, "opencode.jsonc"))
  }
} catch { /* optional */ }

// ============================================================
// Step 5: Verify
// ============================================================
console.log("[5/5] Verifying...")

const probe = Bun.spawn([bun, "run", path.join(embedDir, "sidecar.js"), "--help"], {
  cwd: embedDir,
  stdout: "pipe",
  stderr: "pipe",
})
const probeCode = await probe.exited
if (probeCode !== 0) {
  const err = await new Response(probe.stderr).text()
  console.error("sidecar --help failed:\n", err)
  process.exit(1)
}

const totalSize = (await Bun.spawn(["du", "-sh", embedDir]).exited, 
  (await new Response(Bun.spawnSync(["du", "-sh", embedDir]).stdout).text()).trim())
console.log(`  Total: ${totalSize}`)
console.log("prepare-embed: done")

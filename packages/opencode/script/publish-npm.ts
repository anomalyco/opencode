#!/usr/bin/env bun
/**
 * Fengru npm 发布脚本
 *
 * 完整流程：
 *   1. 构建所有平台二进制
 *   2. 为每个平台创建独立 npm 包
 *   3. 发布平台包到 npm
 *   4. 发布主包 fengru 到 npm
 *
 * 用法：
 *   bun run script/publish-npm.ts              # 完整发布
 *   bun run script/publish-npm.ts --dry-run    # 仅构建，不发布
 *   bun run script/publish-npm.ts --single     # 仅构建当前平台
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "dist")
const pkg = JSON.parse(await Bun.file(path.join(root, "package.json")).text())
const version = process.env.FENGRU_VERSION || pkg.version || "0.0.0-dev"
const dryRun = process.argv.includes("--dry-run")
const tag = process.argv.includes("--tag") ? process.argv[process.argv.indexOf("--tag") + 1] : "latest"

console.log(`\n📦 Fengru npm 发布`)
console.log(`   版本: ${version}`)
console.log(`   Tag:  ${tag}`)
console.log(`   Dry:  ${dryRun}\n`)

// ─── Step 1: 构建所有平台二进制 ───
console.log("🔨 Step 1: 构建二进制...")
const buildFlags = process.argv.includes("--single") ? ["--single"] : []
await $`bun run script/build.ts ${buildFlags}`.cwd(root)

// ─── Step 2: 为每个平台创建 npm 包 ───
console.log("\n📁 Step 2: 创建平台 npm 包...")
const platforms = fs.readdirSync(dist).filter((name) => {
  const pkgPath = path.join(dist, name, "package.json")
  return fs.existsSync(pkgPath)
})

for (const platform of platforms) {
  const platformDir = path.join(dist, platform)
  const platformPkgPath = path.join(platformDir, "package.json")
  const platformPkg = JSON.parse(await Bun.file(platformPkgPath).text())

  // 更新 package.json 使其符合 npm 发布要求
  const publishPkg = {
    name: platformPkg.name,
    version: version,
    description: `Fengru CLI binary for ${platformPkg.os?.[0] || "unknown"}-${platformPkg.cpu?.[0] || "unknown"}`,
    license: "MIT",
    preferUnplugged: true,
    os: platformPkg.os,
    cpu: platformPkg.cpu,
    libc: platformPkg.libc,
    bin: {
      fengru: "./bin/fengru",
    },
    files: ["bin/"],
  }

  await Bun.file(platformPkgPath).write(JSON.stringify(publishPkg, null, 2))

  // 确保二进制有执行权限
  const binDir = path.join(platformDir, "bin")
  if (fs.existsSync(binDir)) {
    for (const file of fs.readdirSync(binDir)) {
      const filePath = path.join(binDir, file)
      if (!file.endsWith(".exe")) {
        fs.chmodSync(filePath, 0o755)
      }
    }
  }

  console.log(`   ✅ ${platform} (${platformPkg.os?.[0]}-${platformPkg.cpu?.[0]})`)
}

// ─── Step 3: 发布平台包 ───
if (!dryRun) {
  console.log("\n🚀 Step 3: 发布平台包到 npm...")
  for (const platform of platforms) {
    const platformDir = path.join(dist, platform)
    console.log(`   📤 ${platform}...`)
    try {
      await $`npm publish --tag ${tag} --access public`.cwd(platformDir)
      console.log(`   ✅ ${platform} 发布成功`)
    } catch (e) {
      console.error(`   ❌ ${platform} 发布失败:`, e)
    }
  }
} else {
  console.log("\n⏭️  Step 3: 跳过发布 (dry-run)")
}

// ─── Step 4: 发布主包 ───
if (!dryRun) {
  console.log("\n🚀 Step 4: 发布主包 fengru...")

  // 更新主 package.json 的版本号
  pkg.version = version
  // 将 optionalDependencies 的 * 替换为具体版本
  if (pkg.optionalDependencies) {
    for (const key of Object.keys(pkg.optionalDependencies)) {
      pkg.optionalDependencies[key] = `^${version}`
    }
  }
  await Bun.file(path.join(root, "package.json")).write(JSON.stringify(pkg, null, 2) + "\n")

  try {
    await $`npm publish --tag ${tag} --access public`.cwd(root)
    console.log("   ✅ fengru 发布成功!")
  } catch (e) {
    console.error("   ❌ fengru 发布失败:", e)
    process.exit(1)
  }
} else {
  console.log("\n⏭️  Step 4: 跳过主包发布 (dry-run)")
}

console.log(`\n✨ 完成! 用户现在可以运行:`)
console.log(`   bun add -g fengru@${version}`)
console.log(`   # 或`)
console.log(`   npm install -g fengru@${version}\n`)

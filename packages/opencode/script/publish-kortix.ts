#!/usr/bin/env bun

/**
 * Publish the OpenCode CLI as @kortix/opencode-ai to npm.
 *
 * This script rewrites platform binary package names and creates a meta-package
 * with optionalDependencies pointing to each platform binary.
 *
 * Prerequisites:
 *   1. Run `KORTIX_BUILD=true bun run build` first to generate dist/ binaries
 *   2. npm login with access to the @kortix org on npm
 *
 * Usage:
 *   bun ./script/publish-kortix.ts               # publish with 'latest' tag
 *   bun ./script/publish-kortix.ts beta           # publish with 'beta' tag
 *
 * Environment:
 *   KORTIX_VERSION    - Version to publish (default: "0.1.0")
 *   DRY_RUN           - Set to "true" to skip actual npm publish
 */

import { $ } from "bun"
import path from "path"
import fs from "fs"

const dir = path.resolve(import.meta.dirname!, "..")
process.chdir(dir)

const tag = process.argv[2] || "latest"
const version = process.env.KORTIX_VERSION || "0.1.0"
const dryRun = process.env.DRY_RUN === "true"
const scope = "@kortix"
const name = "opencode-ai"
const fullName = `${scope}/${name}`

console.log(`Publishing ${fullName}@${version} with tag '${tag}'...`)
if (dryRun) console.log("DRY RUN — no actual publishing will occur")

// 1. Read dist platform binaries
const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  // Skip the meta-package if it exists from a previous run
  if (pkg.name === "opencode" || pkg.name === fullName) continue
  binaries[pkg.name] = pkg.version
}

if (Object.keys(binaries).length === 0) {
  console.error("No platform binaries found in dist/. Run `KORTIX_BUILD=true bun run build` first.")
  process.exit(1)
}

console.log("Platform binaries found:", Object.keys(binaries))

// 2. Rewrite platform binary package names for @kortix scope
const kortixBinaries: Record<string, string> = {}
for (const [originalName, _ver] of Object.entries(binaries)) {
  // opencode-darwin-arm64 -> @kortix/opencode-ai-darwin-arm64
  const suffix = originalName.replace(/^opencode-/, "")
  const kortixName = `${scope}/${name}-${suffix}`
  kortixBinaries[kortixName] = version

  // Rewrite the platform package.json in-place
  const pkgPath = `./dist/${originalName}/package.json`
  const pkg = await Bun.file(pkgPath).json()
  pkg.name = kortixName
  pkg.version = version
  pkg.repository = {
    type: "git",
    url: "https://github.com/kortix-ai/opencode.git",
  }
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2))
  console.log(`  Rewrote ${originalName} -> ${kortixName}`)
}

// 3. Create meta-package directory
const metaDir = `./dist/${name}`
await $`rm -rf ${metaDir}`
await $`mkdir -p ${metaDir}/bin`

// 4. Copy and rewrite bin/opencode wrapper for @kortix scope
const binContent = await Bun.file("./bin/opencode").text()
// Replace the base package name pattern so it looks for @kortix/opencode-ai-<platform>-<arch>
const kortixBinContent = binContent
  .replace(
    `const base = "opencode-" + platform + "-" + arch`,
    `const base = "${scope}/${name}-" + platform + "-" + arch`,
  )
  .replace(
    `const binary = platform === "windows" ? "opencode.exe" : "opencode"`,
    `const binary = platform === "windows" ? "opencode.exe" : "opencode"`,
  )
  // Fix the findBinary function to handle scoped packages in node_modules
  .replace(
    /function findBinary\(startDir\) \{[\s\S]*?^}/m,
    `function findBinary(startDir) {
  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules)) {
      // Check scoped package: node_modules/@kortix/opencode-ai-<platform>-<arch>
      const scopeDir = path.join(modules, "${scope}")
      if (fs.existsSync(scopeDir)) {
        const entries = fs.readdirSync(scopeDir)
        const target = "${name}-" + platform + "-" + arch
        for (const entry of entries) {
          if (!entry.startsWith(target)) continue
          const candidate = path.join(scopeDir, entry, "bin", binary)
          if (fs.existsSync(candidate)) return candidate
        }
      }
      // Also check flat (non-scoped) layout for hoisted packages
      const entries = fs.readdirSync(modules)
      for (const entry of entries) {
        if (!entry.startsWith(base)) continue
        const candidate = path.join(modules, entry, "bin", binary)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}`,
  )
await Bun.write(`${metaDir}/bin/opencode`, kortixBinContent)
await $`chmod +x ${metaDir}/bin/opencode`

// 5. Copy and rewrite postinstall.mjs for @kortix scope
const postinstallContent = await Bun.file("./script/postinstall.mjs").text()
const kortixPostinstall = postinstallContent.replace(
  /const packageName = `opencode-\$\{platform\}-\$\{arch\}`/,
  `const packageName = \`${scope}/${name}-\${platform}-\${arch}\``,
)
await Bun.write(`${metaDir}/postinstall.mjs`, kortixPostinstall)

// 6. Copy LICENSE
if (fs.existsSync("../../LICENSE")) {
  await $`cp ../../LICENSE ${metaDir}/LICENSE`
}

// 7. Write meta-package package.json
await Bun.write(
  `${metaDir}/package.json`,
  JSON.stringify(
    {
      name: fullName,
      version,
      description: "Kortix fork of OpenCode — the AI coding agent for the terminal",
      bin: {
        opencode: "./bin/opencode",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/kortix-ai/opencode.git",
      },
      optionalDependencies: kortixBinaries,
      publishConfig: {
        access: "public",
      },
    },
    null,
    2,
  ),
)

console.log("\nMeta-package created:")
console.log(`  Name: ${fullName}@${version}`)
console.log(`  Optional deps: ${Object.keys(kortixBinaries).join(", ")}`)

// 8. Publish platform binaries
if (!dryRun) {
  const tasks = Object.entries(binaries).map(async ([originalName]) => {
    const distDir = `./dist/${originalName}`
    if (process.platform !== "win32") {
      await $`chmod -R 755 .`.cwd(distDir)
    }
    await $`bun pm pack`.cwd(distDir)
    await $`npm publish *.tgz --access public --tag ${tag}`.cwd(distDir)
    console.log(`  Published: ${(await Bun.file(`${distDir}/package.json`).json()).name}`)
  })
  await Promise.all(tasks)

  // 9. Publish meta-package
  await $`bun pm pack`.cwd(metaDir)
  await $`npm publish *.tgz --access public --tag ${tag}`.cwd(metaDir)
  console.log(`\nPublished ${fullName}@${version} successfully!`)
  console.log(`Install: npm install -g ${fullName}@${version}`)
} else {
  console.log("\nDRY RUN complete. Files prepared in dist/ but not published.")
  console.log("Platform packages:", Object.keys(kortixBinaries))
  console.log(`Meta-package: ${metaDir}/package.json`)
}

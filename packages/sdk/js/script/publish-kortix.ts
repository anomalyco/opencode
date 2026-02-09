#!/usr/bin/env bun

/**
 * Publish the OpenCode SDK as @kortix-ai/opencode-sdk to npm.
 *
 * This script rewrites the package name and exports for publishing,
 * then restores the original package.json afterward. The internal
 * workspace name stays as @opencode-ai/sdk for monorepo compatibility.
 *
 * Usage:
 *   npm login                              # one-time, ensure @kortix-ai org exists on npm
 *   bun ./script/publish-kortix.ts         # publish with 'latest' tag
 *   bun ./script/publish-kortix.ts beta    # publish with 'beta' tag
 */

import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

const tag = process.argv[2] || "latest"

const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))

// Rewrite for publishing
pkg.name = "@kortix/opencode-sdk"
pkg.version = process.env.KORTIX_SDK_VERSION || "0.1.0"
pkg.description = "Kortix fork of the OpenCode SDK — adds file write, delete, mkdir, and rename endpoints"
pkg.repository = {
  type: "git",
  url: "https://github.com/kortix-ai/opencode.git",
  directory: "packages/sdk/js",
}
pkg.publishConfig = {
  directory: "dist",
  access: "public",
}

// Rewrite exports from src .ts to dist .js/.d.ts
for (const [key, value] of Object.entries(pkg.exports as Record<string, string>)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}

await Bun.write("package.json", JSON.stringify(pkg, null, 2))

try {
  console.log(`Publishing ${pkg.name}@${pkg.version} with tag '${tag}'...`)
  await $`bun pm pack`
  await $`npm publish *.tgz --tag ${tag} --access public`
  console.log(`\nPublished ${pkg.name}@${pkg.version} successfully.`)
  console.log(`Install: npm install ${pkg.name}@${pkg.version}`)
} finally {
  // Restore original package.json so the monorepo workspace isn't broken
  await Bun.write("package.json", JSON.stringify(original, null, 2))
  await $`rm -f *.tgz`.nothrow()
}

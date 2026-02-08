#!/usr/bin/env bun
/**
 * Claxedo Build All Script
 *
 * Orchestrates builds for all platforms:
 * - Web/Cloud build (Vite)
 * - Desktop builds (macOS, Windows, Linux)
 *
 * Usage:
 *   bun ./scripts/build-all.ts [--web] [--desktop] [--platform=<platform>]
 *
 * Options:
 *   --web              Build web/cloud version only
 *   --desktop          Build desktop versions only
 *   --platform=<p>     Specific platform (macos, windows, linux, all)
 *   --prod             Production build (code signing, optimizations)
 *
 * Examples:
 *   bun ./scripts/build-all.ts                    # Build everything
 *   bun ./scripts/build-all.ts --web              # Web only
 *   bun ./scripts/build-all.ts --desktop          # All desktop platforms
 *   bun ./scripts/build-all.ts --platform=macos   # macOS desktop only
 */

import { $ } from "bun"

// Parse arguments
const args = Bun.argv.slice(2)
const webOnly = args.includes("--web")
const desktopOnly = args.includes("--desktop")
const isProd = args.includes("--prod")
const platformArg = args.find((arg) => arg.startsWith("--platform="))
const platform = platformArg?.split("=")[1] || "all"

const buildWeb = !desktopOnly
const buildDesktop = !webOnly

const claxedoAppDir = new URL("..", import.meta.url).pathname

// eslint-disable-next-line no-console
console.log(`[build-all] Starting build process...`)
// eslint-disable-next-line no-console
console.log(`[build-all] Web: ${buildWeb}, Desktop: ${buildDesktop}, Platform: ${platform}`)
// eslint-disable-next-line no-console
console.log(`[build-all] Mode: ${isProd ? "production" : "development"}`)
// eslint-disable-next-line no-console
console.log(``)

const results: { target: string; success: boolean; error?: string }[] = []

// Build Web
if (buildWeb) {
  // eslint-disable-next-line no-console
  console.log(`[build-all] Building web/cloud version...`)
  const webBuild = await $`bunx vite build --config vite.cloud.config.ts`
    .cwd(claxedoAppDir)
    .env({
      ...Bun.env,
      CLAXEDO_OVERRIDES: "1",
    })
    .nothrow()

  if (webBuild.exitCode === 0) {
    results.push({ target: "web", success: true })
    // eslint-disable-next-line no-console
    console.log(`[build-all] Web build complete: dist/`)
  } else {
    results.push({ target: "web", success: false, error: `Exit code ${webBuild.exitCode}` })
    // eslint-disable-next-line no-console
    console.error(`[build-all] Web build failed`)
  }
}

// Build Desktop
if (buildDesktop) {
  const desktopArgs = ["./scripts/desktop-build.ts"]
  if (isProd) desktopArgs.push("--prod")
  if (platform !== "all") desktopArgs.push(`--platform=${platform}`)

  // eslint-disable-next-line no-console
  console.log(`[build-all] Building desktop version...`)
  const desktopBuild = await $`bun ${desktopArgs}`
    .cwd(claxedoAppDir)
    .env({
      ...Bun.env,
      CLAXEDO_OVERRIDES: "1",
    })
    .nothrow()

  if (desktopBuild.exitCode === 0) {
    results.push({ target: `desktop-${platform}`, success: true })
    // eslint-disable-next-line no-console
    console.log(`[build-all] Desktop build complete`)
  } else {
    results.push({
      target: `desktop-${platform}`,
      success: false,
      error: `Exit code ${desktopBuild.exitCode}`,
    })
    // eslint-disable-next-line no-console
    console.error(`[build-all] Desktop build failed`)
  }
}

// Summary
// eslint-disable-next-line no-console
console.log(``)
// eslint-disable-next-line no-console
console.log(`[build-all] Build Summary:`)
// eslint-disable-next-line no-console
console.log(`${"─".repeat(50)}`)

for (const result of results) {
  const status = result.success ? "✓" : "✗"
  const message = result.error ? ` (${result.error})` : ""
  // eslint-disable-next-line no-console
  console.log(`  ${status} ${result.target}${message}`)
}

// eslint-disable-next-line no-console
console.log(`${"─".repeat(50)}`)

const failed = results.filter((r) => !r.success)
if (failed.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`[build-all] ${failed.length} build(s) failed`)
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log(`[build-all] All builds successful!`)

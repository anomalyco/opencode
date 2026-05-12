#!/usr/bin/env bun

/**
 * rebrand-smoke.ts — End-to-end smoke tests for OpenCode→Octopus rebrand
 *
 * Usage:
 *   bun run script/rebrand-smoke.ts
 *
 * Run from repo root after all 9 Issues are complete.
 */

interface SmokeTest {
  name: string
  description: string
  run: () => Promise<{ passed: boolean; detail: string }>
  critical: boolean // false = soft failure (allows proceed but record)
}

const tests: SmokeTest[] = [
  {
    name: "typecheck",
    description: "Full turbo typecheck passes",
    critical: true,
    run: async () => {
      const proc = Bun.spawn(["bun", "turbo", "typecheck"], { stdio: ["ignore", "pipe", "pipe"] })
      const out = await new Response(proc.stdout).text()
      const exitCode = await proc.exited
      return { passed: exitCode === 0, detail: exitCode === 0 ? "OK" : `Exit code ${exitCode}` }
    },
  },
  {
    name: "frozen-lockfile",
    description: "bun install --frozen-lockfile succeeds",
    critical: true,
    run: async () => {
      const proc = Bun.spawn(["bun", "install", "--frozen-lockfile"], { stdio: ["ignore", "pipe", "pipe"] })
      const out = await new Response(proc.stdout).text()
      const exitCode = await proc.exited
      return { passed: exitCode === 0, detail: exitCode === 0 ? "OK" : out.slice(0, 200) }
    },
  },
  {
    name: "package-names",
    description: "All package.json name fields use @octopus-ai/ scope",
    critical: true,
    run: async () => {
      const glob = new Bun.Glob("packages/*/package.json")
      const bad: string[] = []
      for await (const file of glob.scan()) {
        const pkg = await Bun.file(file).json()
        if (pkg.name && !pkg.name.startsWith("@octopus-ai/") && pkg.name !== "@octopus-ai/octopus") {
          bad.push(`${file}: ${pkg.name}`)
        }
      }
      return { passed: bad.length === 0, detail: bad.length === 0 ? "OK" : bad.join("; ") }
    },
  },
  {
    name: "binary-name",
    description: "CLI bin is named octopus",
    critical: true,
    run: async () => {
      const binExists = await Bun.file("packages/octopus/bin/octopus").exists()
      return { passed: binExists, detail: binExists ? "packages/octopus/bin/octopus exists" : "MISSING" }
    },
  },
  {
    name: "turbo-tasks",
    description: "turbo.json has no opencode# prefixed tasks",
    critical: false,
    run: async () => {
      const turbo = await Bun.file("turbo.json").text()
      const hasOldTasks = turbo.includes("opencode#") || turbo.includes("@opencode-ai/")
      return { passed: !hasOldTasks, detail: hasOldTasks ? "Found opencode# tasks in turbo.json" : "OK" }
    },
  },
  {
    name: "nix-package",
    description: "Nix package file is octopus.nix",
    critical: false,
    run: async () => {
      const exists = await Bun.file("nix/octopus.nix").exists()
      const oldExists = await Bun.file("nix/opencode.nix").exists()
      return { passed: exists && !oldExists, detail: exists ? "nix/octopus.nix exists" : "MISSING" }
    },
  },
  {
    name: "workflow-name",
    description: "CI workflow is octopus.yml",
    critical: false,
    run: async () => {
      const exists = await Bun.file(".github/workflows/octopus.yml").exists()
      const oldExists = await Bun.file(".github/workflows/opencode.yml").exists()
      return { passed: exists && !oldExists, detail: exists ? ".github/workflows/octopus.yml exists" : "MISSING" }
    },
  },
]

async function main() {
  console.log("🔍 Octopus Rebrand Smoke Tests\n")
  let passed = 0,
    failed = 0,
    criticalFailed = 0

  for (const test of tests) {
    process.stdout.write(`  ${test.name}... `)
    try {
      const result = await test.run()
      if (result.passed) {
        console.log(`✅ ${result.detail}`)
        passed++
      } else {
        console.log(`❌ ${result.detail}`)
        failed++
        if (test.critical) criticalFailed++
      }
    } catch (e: any) {
      console.log(`💥 ${e.message}`)
      failed++
      if (test.critical) criticalFailed++
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed (${criticalFailed} critical)`)
  if (criticalFailed > 0) {
    console.log("❌ Critical failures — rebrand incomplete")
    process.exit(1)
  } else if (failed > 0) {
    console.log("⚠️ Non-critical failures — investigate before release")
    process.exit(0)
  } else {
    console.log("✅ All smoke tests passed")
  }
}

main()

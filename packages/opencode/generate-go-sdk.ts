#!/usr/bin/env bun
import { $ } from "bun"

const sdkDir = "../sdk/stainless"
const originalDir = process.cwd()

try {
  process.chdir(sdkDir)
  console.log("=== Generating Stainless SDK (Go) ===")
  console.log("Working directory:", process.cwd())

  // Generate Go SDK using Stainless
  console.log("\n1. Generating Go SDK with Stainless...")
  await $`stl builds create --branch main --pull --allow-empty --+target go`

  // Move Go SDK to packages/sdk/go
  console.log("\n2. Moving Go SDK to packages/sdk/go...")
  await $`rm -rf ../go`
  await $`mv opencode-go/ ../go`
  await $`rm -rf ../go/.git`

  console.log("\n✓ SDK generation complete!")
  console.log("✓ Go SDK available at packages/sdk/go")
  console.log("\nNote: TypeScript SDK is generated separately by Stainless and published to npm")
} catch (error) {
  console.error("Error generating SDK:", error)
  process.exit(1)
} finally {
  process.chdir(originalDir)
}

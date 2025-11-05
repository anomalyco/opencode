#!/usr/bin/env bun
import { $ } from "bun"

const sdkDir = "../sdk/stainless"
process.chdir(sdkDir)

console.log("=== Generating Stainless SDK ===")
console.log("Working directory:", process.cwd())

// Clean up old go SDK
await $`rm -rf go`

// Generate OpenAPI spec
console.log("\n1. Generating OpenAPI spec...")
await $`bun run --conditions=node ../../opencode/src/index.ts generate > openapi.json`
console.log("✓ OpenAPI spec generated")

// Generate Go SDK using Stainless
console.log("\n2. Generating Go SDK with Stainless...")
await $`stl builds create --branch main --pull --allow-empty --+target go`

// Move Go SDK to packages/sdk/go
console.log("\n3. Moving Go SDK to packages/sdk/go...")
await $`rm -rf ../go`
await $`mv opencode-go/ ../go`
await $`rm -rf ../go/.git`

console.log("\n✓ SDK generation complete!")
console.log("✓ Go SDK available at packages/sdk/go")

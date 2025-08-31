#!/usr/bin/env bun

/**
 * Prepare the package for npm publishing
 */

import { $ } from "bun"

async function main() {
  console.log("Preparing package for npm publishing...")
  
  // Ensure bin scripts are executable
  await $`chmod +x ./bin/lash`
  console.log("✓ Made bin/lash executable")
  
  // Remove any old build artifacts
  await $`rm -rf ./dist/lash-cli || true`.quiet()
  console.log("✓ Cleaned up old artifacts")
  
  console.log("\n✨ Package prepared for npm publishing!")
  console.log("\nNote: This package requires Bun to be installed on the target system.")
}

main()
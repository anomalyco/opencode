#!/usr/bin/env bun

import { $ } from "bun"

await $`bun run prettier --ignore-unknown --write .`

// Format Rust files with cargo fmt
const rustProjects = ["packages/desktop/src-tauri"]

for (const project of rustProjects) {
  const cargoPath = `${project}/Cargo.toml`

  try {
    await $`test -f ${cargoPath}`
    await $`cargo fmt --manifest-path ${cargoPath}`
    console.log(`Formatted Rust files in ${project}`)
  } catch (error) {
    console.log(`No Rust project found at ${project}, skipping...`)
  }
}

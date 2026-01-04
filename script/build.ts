#!/usr/bin/env bun

// Delegate to the opencode package build script
import { $ } from "bun"

await $`bun run --cwd packages/opencode build ${process.argv.slice(2).join(' ')}`

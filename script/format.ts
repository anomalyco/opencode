#!/usr/bin/env bun

import { $ } from "bun"

const check = Bun.argv.includes("--check")

await $`bun run prettier --ignore-unknown ${check ? "--check" : "--write"} .`

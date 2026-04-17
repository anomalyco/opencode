#!/usr/bin/env bun

import { $ } from "bun"

const dir = Bun.argv[2] ?? "."

await $`bun run prettier --ignore-unknown --write ${dir}`

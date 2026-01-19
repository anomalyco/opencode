#!/usr/bin/env bun

import { $ } from "bun"

await $`bun run prettier --ignore-unknown --write .`

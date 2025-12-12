#!/usr/bin/env bun

import { $ } from "bun"

await $`bun run prettier --ignore-unknown --write .`

if (process.env["CI"] && (await $`git status --porcelain`.text())) {
  await $`git config --local user.email "action@github.com"`
  await $`git config --local user.name "GitHub Action"`
  await $`git add -A`
  await $`git commit -m "chore: format code"`
  const branch = process.env["PUSH_BRANCH"]
  await $`git push origin HEAD:${branch} --no-verify`
}

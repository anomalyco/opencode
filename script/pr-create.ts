#!/usr/bin/env bun

import path from "node:path"

const need = [
  "### Issue for this PR",
  "### Type of change",
  "### What does this PR do?",
  "### How did you verify your code works?",
  "### Screenshots / recordings",
  "### Checklist",
]

const help = () => {
  console.log(`Usage: bun run pr:create -- [gh pr create args]

Required:
  --body-file <path>   Path to PR body markdown file

Examples:
  bun run pr:create -- --base dev --title "feat: add foo" --body-file /tmp/pr.md
  bun run pr:create -- --base dev --head my-branch --body-file .github/pull_request_template.md
`)
}

const fail = (msg: string) => {
  console.error(msg)
  process.exit(1)
}

const args = Bun.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  help()
  process.exit(0)
}

const bodyIndex = args.findIndex((x) => x === "--body-file" || x === "-F")
if (bodyIndex === -1) fail("Missing --body-file/-F. This wrapper validates PR template before creating PR.")

const bodyArg = args[bodyIndex + 1]
if (!bodyArg) fail("Missing value for --body-file/-F.")

const bodyPath = path.resolve(process.cwd(), bodyArg)
const bodyFile = Bun.file(bodyPath)
if (!(await bodyFile.exists())) fail(`PR body file not found: ${bodyArg}`)

const body = await bodyFile.text()
for (const section of need) {
  if (body.includes(section)) continue
  fail(`Missing required section: ${section}`)
}

const checked = /- \[x\] (Bug fix|New feature|Refactor \/ code improvement|Documentation)/.test(body)
if (!checked) fail("No checked 'Type of change' checkbox found.")

const run = Bun.spawnSync(["gh", "pr", "create", ...args], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: process.env,
})

process.exit(run.exitCode)

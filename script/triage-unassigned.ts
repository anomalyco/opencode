#!/usr/bin/env bun

import { parseArgs } from "util"

async function run(command: string, args: string[], options: Bun.SpawnOptions.OptionsObject = {}) {
  const process = Bun.spawn([command, ...args], options)
  const status = await process.exited
  if (status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${status}`)
  return process
}

async function text(command: string, args: string[]) {
  const process = await run(command, args, { stdout: "pipe", stderr: "inherit" })
  return new Response(process.stdout).text()
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      days: { type: "string", short: "d", default: "30" },
      limit: { type: "string", short: "l", default: "200" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (values.help) {
    console.log(`
Usage: bun script/triage-unassigned.ts [options]

Triage open GitHub issues created in the last 30 days with no assignee.

Options:
  -d, --days <days>    Look back this many days (default: 30)
  -l, --limit <count>  Maximum issues to process (default: 200)
      --dry-run        Print matching issues without running triage
  -h, --help           Show this help message

Examples:
  bun script/triage-unassigned.ts
  bun script/triage-unassigned.ts --limit 3
  bun script/triage-unassigned.ts --dry-run
`)
    process.exit(0)
  }

  const days = Number(values.days)
  const limit = Number(values.limit)
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive integer")
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer")

  const created = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const query = `no:assignee created:>=${created}`
  const issues = JSON.parse(
    await text("gh", [
      "issue",
      "list",
      "--state",
      "open",
      "--search",
      query,
      "--limit",
      String(limit),
      "--json",
      "number,title,body",
    ]),
  ) as Array<{ number: number; title: string; body?: string | null }>

  console.log(`Found ${issues.length} open unassigned issues created since ${created}`)
  if (issues.length === 0) return

  if (values["dry-run"]) {
    for (const issue of issues) console.log(`#${issue.number} ${issue.title}`)
    return
  }

  const githubToken = process.env.GITHUB_TOKEN || (await text("gh", ["auth", "token"])).trim()
  const failures: Array<{ issue: number; error: string }> = []

  for (const [index, issue] of issues.entries()) {
    console.log(`\n[${index + 1}/${issues.length}] Triaging #${issue.number} ${issue.title}`)
    const result = Bun.spawn(
      [
        "opencode",
        "run",
        "--agent",
        "triage",
        `The following issue was just opened, triage it:

Issue: #${issue.number}
Title: ${issue.title}

Body:
${issue.body ?? ""}`,
      ],
      {
        env: {
          ...process.env,
          GITHUB_TOKEN: githubToken,
          ISSUE_NUMBER: String(issue.number),
          ISSUE_TITLE: issue.title,
          ISSUE_BODY: issue.body ?? "",
        },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    )
    const status = await result.exited

    if (status === 0) {
      console.log(`[${index + 1}/${issues.length}] Done #${issue.number}`)
      continue
    }

    failures.push({ issue: issue.number, error: `opencode exited with ${status}` })
    console.error(`[${index + 1}/${issues.length}] Failed #${issue.number}: opencode exited with ${status}`)
  }

  console.log(`\nFinished triaging ${issues.length - failures.length}/${issues.length} issues`)
  if (failures.length === 0) return

  console.error("Failures:")
  for (const failure of failures) console.error(`#${failure.issue}: ${failure.error}`)
  process.exit(1)
}

void main()

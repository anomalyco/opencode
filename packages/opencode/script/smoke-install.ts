#!/usr/bin/env bun

/**
 * Manual smoke test for plugin install sources. Not run in CI.
 *
 * Example:
 *   bun run script/smoke-install.ts \
 *     --registry @opencode-ai/plugin@latest \
 *     --github opencode-ai/plugin#main \
 *     --github-subdir opencode-ai/monorepo#main::path:packages/foo \
 *     --git-url git+https://github.com/opencode-ai/plugin.git#main \
 *     --release opencode-ai/plugin:v1.0.0:plugin.tgz \
 *     --release-anon opencode-ai/public:v1.0.0:asset.tgz \
 *     --file /abs/local/plugin
 */
import { Npm } from "../src/npm"

type Case = { kind: string; spec: string; anon?: boolean }

function parseArgs(argv: string[]) {
  const cases: Case[] = []
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!value) throw new Error(`missing value for ${flag}`)
    switch (flag) {
      case "--registry":
        cases.push({ kind: "registry", spec: value })
        break
      case "--github":
        cases.push({ kind: "github", spec: `github:${value}` })
        break
      case "--github-subdir":
        cases.push({ kind: "github-subdir", spec: `github:${value}` })
        break
      case "--git-url":
        cases.push({ kind: "git-url", spec: value })
        break
      case "--release": {
        const [repo, tag, asset] = value.split(":")
        cases.push({
          kind: "release",
          spec: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
        })
        break
      }
      case "--release-anon": {
        const [repo, tag, asset] = value.split(":")
        cases.push({
          kind: "release-anon",
          spec: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
          anon: true,
        })
        break
      }
      case "--file":
        cases.push({ kind: "file", spec: value })
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }
  return cases
}

async function main() {
  const cases = parseArgs(process.argv)
  if (cases.length === 0) {
    console.error(
      "no cases specified; pass one or more of --registry, --github, --github-subdir, --git-url, --release, --release-anon, --file",
    )
    process.exit(2)
  }

  const needsAuth = cases.some(
    (x) => x.kind === "release" || x.kind === "github" || x.kind === "github-subdir" || x.kind === "git-url",
  )
  if (needsAuth) {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
    if (!token) {
      const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" })
      const code = await proc.exited
      if (code !== 0) {
        console.error("no GITHUB_TOKEN/GH_TOKEN env and `gh auth token` failed; some cases may fail")
      }
    }
  }

  const results: Array<{
    kind: string
    spec: string
    ok: boolean
    detail: string
    ms: number
  }> = []

  for (const item of cases) {
    const started = Date.now()
    try {
      if (item.anon) {
        const savedToken = process.env.GITHUB_TOKEN
        const savedGh = process.env.GH_TOKEN
        delete process.env.GITHUB_TOKEN
        delete process.env.GH_TOKEN
        try {
          const result = await Npm.add(item.spec)
          results.push({
            kind: item.kind,
            spec: item.spec,
            ok: true,
            detail: result.directory,
            ms: Date.now() - started,
          })
        } finally {
          if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken
          if (savedGh !== undefined) process.env.GH_TOKEN = savedGh
        }
      } else {
        const result = await Npm.add(item.spec)
        results.push({
          kind: item.kind,
          spec: item.spec,
          ok: true,
          detail: result.directory,
          ms: Date.now() - started,
        })
      }
    } catch (err) {
      results.push({
        kind: item.kind,
        spec: item.spec,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      })
    }
  }

  console.log()
  console.log("Smoke results:")
  for (const item of results) {
    console.log(`  ${item.ok ? "PASS" : "FAIL"} ${item.kind} (${item.ms}ms) ${item.spec}`)
    if (!item.ok) console.log(`      ${item.detail}`)
  }

  const failures = results.filter((x) => !x.ok)
  if (failures.length > 0) {
    console.log()
    console.log(`${failures.length} / ${results.length} failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

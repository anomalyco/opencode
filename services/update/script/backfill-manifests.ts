import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildManifestEntries, type ArtifactRow } from "../src/manifest"

const query = `SELECT channel, name, distribution, version, metadata, active, minimum, time_created, time_updated
FROM artifact INDEXED BY artifact_active WHERE active = 1
UNION ALL
SELECT channel, name, distribution, version, metadata, active, minimum, time_created, time_updated
FROM artifact INDEXED BY artifact_minimum WHERE minimum = 1 AND active = 0
ORDER BY channel, name, distribution`

function parseArgs(argv: string[]) {
  const remote = argv.includes("--remote")
  const local = argv.includes("--local")
  const dryRun = argv.includes("--dry-run")
  const nsIndex = argv.indexOf("--namespace-id")
  const namespaceId = nsIndex >= 0 ? argv[nsIndex + 1] : undefined
  if (remote === local) {
    throw new Error(
      "Pass exactly one of --remote or --local. Usage: bun run script/backfill-manifests.ts --remote [--dry-run] [--namespace-id <id>]",
    )
  }
  if (nsIndex >= 0 && (!namespaceId || namespaceId.startsWith("-"))) {
    throw new Error("--namespace-id requires a value")
  }
  return { remote, dryRun, namespaceId }
}

async function runWrangler(cwd: string, args: string[]) {
  const proc = Bun.spawn(["./node_modules/.bin/wrangler", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed (exit ${exitCode}):\n${stderr || stdout}`)
  }
  return stdout
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2))
  const serviceDir = path.resolve(import.meta.dir, "..")
  const locationFlag = options.remote ? "--remote" : "--local"

  const raw = await runWrangler(serviceDir, ["d1", "execute", "DB", locationFlag, "--json", "--command", query])
  const parsed = JSON.parse(raw) as Array<{ results?: ArtifactRow[]; success?: boolean }>
  const rows = parsed[0]?.results
  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected wrangler d1 execute output: ${raw.slice(0, 500)}`)
  }

  const entries = buildManifestEntries(rows)
  console.log(`Loaded ${rows.length} active/minimum rows from D1 -> ${entries.length} KV entries`)
  for (const entry of entries) {
    console.log(`  ${entry.key} (${entry.value.length} bytes)`)
  }

  if (options.dryRun) {
    console.log("Dry run: skipped writing to KV.")
    return
  }

  if (!entries.length) {
    console.log("No active rows found in D1; nothing to write.")
    return
  }

  const dir = mkdtempSync(path.join(tmpdir(), "opencode-update-backfill-"))
  try {
    const file = path.join(dir, "manifests.json")
    await Bun.write(file, JSON.stringify(entries))
    const targetArgs = options.namespaceId ? ["--namespace-id", options.namespaceId] : ["--binding", "MANIFESTS"]
    await runWrangler(serviceDir, ["kv", "bulk", "put", file, ...targetArgs, locationFlag])
    console.log(`Wrote ${entries.length} KV entries.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

await main()

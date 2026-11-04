// P-CLI (plan 7.1): runs one command with the TS CLI and with `opencode-rs`, each against its own fake
// server, and compares exit code, stdout, stderr, and the requests after normalization.
//
//   bun run parity/cli/run.ts [--sides ts,rs] [scenario.cli.ts ...]
//
// Without files it runs every `parity/scenarios/**/*.cli.ts`. `--sides ts,ts` checks that a case is
// deterministic. Each side's record goes to `$TMPDIR/opencode-parity/cli/<name>.<n>-<side>.json`.

import { parseArgs } from "node:util"
import { Glob } from "bun"
import path from "node:path"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { startFakeServer, type Logged, type Options } from "../lib/fake-server"
import {
  buildRust,
  command,
  nameOf,
  normalize,
  parityRoot,
  parseSides,
  sandbox,
  withServer,
  type Context,
  type Side,
} from "./client"
import { diffRecords } from "./diff"

export type CliCase = {
  args: string[]
  // Runs this program on each side instead of the CLI (`args` and `server` are then unused).
  command?: (side: Side) => string[]
  // A fake server for `--server`; omit it for commands that need no server (`--version`, help).
  server?: Options
  env?: Record<string, string>
  stdin?: string
  timeout?: number
  // Rust lacks the command so far: the case runs only with `--sides ts,ts`.
  tsOnly?: boolean
  // Compare only the first lines of stderr, when what follows names each client's own internals (a JS stack
  // trace, the output of a different child process). The case says why.
  stderrLines?: number
  // Files written into the working directory before the run, by relative path.
  files?: Record<string, string | Uint8Array>
  // Replacements applied to stdout, stderr, and the request log after the normalizers, for values that differ
  // per run (a `Date.now()` timestamp). Each says why in the scenario.
  masks?: { pattern: RegExp; replacement: string }[]
  // Sends `name` to the client once a request for `after` (a path) has reached the fake server.
  signal?: { after: string; name: NodeJS.Signals }
}

export function defineCli(value: CliCase) {
  return value
}

export type CliRecord = Awaited<ReturnType<typeof runCli>>

export async function runCli(side: Side, value: CliCase) {
  const box = await sandbox(value.env)
  await Promise.all(
    Object.entries(value.files ?? {}).map(([file, content]) => Bun.write(path.join(box.cwd, file), content)),
  )
  const server = value.server ? await startFakeServer(value.server) : undefined
  const proc = Bun.spawn(value.command?.(side) ?? command(side, withServer(value.args, server?.url)), {
    cwd: box.cwd,
    env: box.env,
    stdin: value.stdin === undefined ? "ignore" : new TextEncoder().encode(value.stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: value.timeout ?? 30_000,
  })
  if (value.signal && server) {
    const signal = value.signal
    void (async () => {
      while (!server.requests.some((entry) => entry.path === signal.after) && proc.exitCode === null)
        await Bun.sleep(20)
      // Let the client finish handling the answer before the signal.
      await Bun.sleep(200)
      proc.kill(signal.name)
    })()
  }
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  await server?.stop()
  await rm(box.root, { recursive: true, force: true })
  const context = { server: server?.url, root: box.root }
  const mask = (text: string) =>
    (value.masks ?? []).reduce((current, item) => current.replace(item.pattern, item.replacement), text)
  const requests = requestLog(server?.requests ?? [], context)
  return {
    exit,
    ...(proc.signalCode ? { signal: proc.signalCode } : {}),
    stdout: mask(normalize(stdout, context)),
    stderr: mask(
      normalize(
        value.stderrLines === undefined ? stderr : stderr.split("\n").slice(0, value.stderrLines).join("\n"),
        context,
      ),
    ),
    requests: { reads: requests.reads.map(mask), writes: requests.writes.map(mask) },
  }
}

// Plan 7.1 P-REQ: mutating requests in order, reads as a sorted set.
export function requestLog(requests: Logged[], context: Context) {
  const line = (entry: Logged) => {
    // Decoded, so the normalizers see paths and IDs inside query values.
    const query = Object.entries(entry.query)
      .flatMap(([key, values]) => values.map((value) => `${key}=${value}`))
      .join("&")
    const target = `${entry.method} ${entry.path}${query ? `?${query}` : ""}${entry.unmatched ? " (unmatched)" : ""}`
    return normalize(entry.body === undefined ? target : `${target} ${JSON.stringify(entry.body)}`, context)
  }
  return {
    reads: [...new Set(requests.filter((entry) => entry.method === "GET").map(line))].toSorted(),
    writes: requests.filter((entry) => entry.method !== "GET").map(line),
  }
}

if (import.meta.main) {
  const parsed = parseArgs({ args: Bun.argv.slice(2), options: { sides: { type: "string" } }, allowPositionals: true })
  const sides = parseSides(parsed.values.sides)
  const files = parsed.positionals.length
    ? parsed.positionals.map((file) => path.resolve(file))
    : [...new Glob("scenarios/**/*.cli.ts").scanSync({ cwd: parityRoot, absolute: true })].toSorted()
  await buildRust(sides)
  const results = await Promise.all(
    files.map(async (file) => {
      const value: CliCase = (await import(file)).default
      const name = nameOf(file)
      if (value.tsOnly && sides.includes("rs")) return { name, skipped: true, report: "" }
      const records = await Promise.all(sides.map((side) => runCli(side, value)))
      await Promise.all(
        records.map((record, index) =>
          Bun.write(
            path.join(tmpdir(), "opencode-parity/cli", `${name}.${index}-${sides[index]}.json`),
            JSON.stringify(record, null, 2) + "\n",
          ),
        ),
      )
      return { name, skipped: false, report: diffRecords(records[0], records[1], sides) }
    }),
  )
  results.forEach((result) =>
    console.log(
      result.skipped
        ? `skip ${result.name} (tsOnly)`
        : result.report
          ? `FAIL ${result.name}\n${result.report}`
          : `ok   ${result.name}`,
    ),
  )
  process.exit(results.some((result) => result.report) ? 1 : 0)
}

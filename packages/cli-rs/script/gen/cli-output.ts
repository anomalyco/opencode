// Records what the TypeScript CLI prints for help, completions, and usage errors, with colors (FORCE_COLOR=1),
// into crates/cli/tests/fixtures/cli. Each usage error records the environment it ran in. The Rust tests in
// crates/cli/src/tests/output.rs compare their own output with these files byte for byte, and with the colors
// stripped for a run without a terminal.
import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { Commands } from "../../../cli/src/commands/commands"
import { command, sandbox } from "../../parity/cli/client"

type Node = { readonly name: string; readonly commands: Record<string, Node> }

// Usage errors: each line is the argument list after the program name.
const errors: string[][] = [
  ["upgrade", "--method", "apt"],
  ["upgrade", "-m"],
  ["debug", "nope"],
  ["auth", "logn"],
  ["debug", "paths", "nope"],
  ["stats", "--days", "-1"],
  ["stats", "--days", "1.5"],
  ["stats", "--days", "abc"],
  ["stats", "--year", "1969"],
  ["stats", "--limit", "0"],
  ["session", "delete"],
  ["session", "list", "-n"],
  ["session", "list", "--format", "xml"],
  ["service", "set", "key"],
  ["mcp", "logout"],
  ["plugin", "add"],
  ["api"],
  ["api", "a", "b", "c"],
  ["api", "a", "b", "c", "d"],
  ["api", "op", "--param", "novalue"],
  ["api", "op", "--param", "=1"],
  ["mcp", "add", "x", "--header", "k="],
  ["run", "--modle", "x"],
  ["run", "-x", "hi"],
  ["run", "-cx", "hi"],
  ["run", "--bogus", "--worse"],
  ["run", "--no-continu"],
  ["run", "--yol"],
  ["run", "-1x"],
  ["run", "-=v"],
  ["run", "-s", "a", "-s", "b"],
  ["run", "-c", "--continue"],
  ["run", "--auto=maybe"],
  ["run", "-w=a", "--worktree=b"],
  ["mini", "--replay-limit", "abc"],
  ["mini", "--replay-limit", "1.5"],
  ["mini", "--no-replay=true"],
  ["mini", "--no-replay", "true"],
  ["mini", "--replay", "--no-replay"],
  ["uninstall", "--dry-run", "--dry-run"],
  ["pair", "--url", "ftp://example.com"],
  ["pair", "--url", "https://user:secret@example.com"],
  ["pair", "--url", "not a url"],
  ["serve", "--cors", ""],
  ["serve", "--port", "x"],
  ["-c", "upgrade"],
  ["--prompt", "hi", "run"],
  ["--auto", "--continue", "session", "list"],
  ["--server"],
  ["upgrade", "--server", "http://a"],
  ["--server", "http://a", "upgrade"],
  ["--standalone", "debug", "heap-dump"],
  ["--server", "a", "session", "list", "--server", "b"],
  ["--standalone", "auth", "list", "--standalone"],
  ["--log-level", "bogus"],
  ["--log-level"],
  ["--completions", "bogus"],
  ["--help", "--help"],
  ["--print-logs=maybe"],
  ["session", "--bogus", "list"],
  ["auth", "list", "extra"],
  ["service", "status", "extra", "more"],
  ["-x"],
  ["run", "--bogus", "-s", "--also-bogus"],
  ["run", "--unknown", "--model", "--another"],
  ["debug", "--bogus", "nope", "--also-bogus"],
]

// Usage errors in another environment than FORCE_COLOR=1, recorded with it.
const environments: { args: string[]; env: Record<string, string> }[] = [
  { args: ["run", "--bogus"], env: { FORCE_COLOR: "false" } },
  { args: ["run", "--bogus"], env: { FORCE_COLOR: "FALSE" } },
  { args: ["run", "--bogus"], env: { FORCE_COLOR: "0" } },
  { args: ["run", "--bogus", "--worse"], env: { FORCE_COLOR: "1", NO_COLOR: "1" } },
]

const root = Commands as unknown as Node
const paths: string[][] = []
const visit = (node: Node, prefix: string[]) => {
  paths.push(prefix)
  for (const child of Object.values(node.commands)) visit(child, [...prefix, child.name])
}
visit(root, [])

const out = path.resolve(import.meta.dir, "../../crates/cli/tests/fixtures/cli")
await rm(out, { recursive: true, force: true })
await mkdir(path.join(out, "help"), { recursive: true })
await mkdir(path.join(out, "completions"), { recursive: true })

const run = async (args: string[], env: Record<string, string> = { FORCE_COLOR: "1" }) => {
  const box = await sandbox(env)
  const proc = Bun.spawn(command("ts", args), {
    cwd: box.cwd,
    env: box.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  await rm(box.root, { recursive: true, force: true })
  return { args, env, exit, stdout, stderr }
}

// A few processes at a time: each one starts the whole TypeScript CLI.
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index])
      }
    }),
  )
  return results
}

const expectClean = (record: Awaited<ReturnType<typeof run>>) => {
  if (record.exit !== 0 || record.stderr !== "")
    throw new Error(`${record.args.join(" ")}: exit ${record.exit}\n${record.stderr}`)
  return record.stdout
}

await pool(paths, 6, async (prefix) => {
  const stdout = expectClean(await run([...prefix, "--help"]))
  await Bun.write(path.join(out, "help", `${["opencode", ...prefix].join(" ")}.txt`), stdout)
})
await pool(["bash", "zsh", "fish", "powershell"], 4, async (shell) => {
  const stdout = expectClean(await run(["--completions", shell]))
  await Bun.write(path.join(out, "completions", `${shell}.txt`), stdout)
})
const records = [
  ...(await pool(errors, 6, (args) => run(args))),
  ...(await pool(environments, 4, (item) => run(item.args, item.env))),
]
await Bun.write(path.join(out, "errors.json"), JSON.stringify(records, null, 2) + "\n")
console.log(`cli-output: wrote ${paths.length} help pages, 4 completion scripts, ${records.length} errors to ${out}`)

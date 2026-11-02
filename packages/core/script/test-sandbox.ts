import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../test/fixture/tmpdir"

// Release enforcement gate: ordinary tests may skip unavailable Seatbelt/runtimes;
// this entry point must never report a successful enforcement run with skips.
if (process.platform !== "darwin") throw new Error("Sandbox validation requires a macOS host")
const probe = Bun.spawnSync([
  "/usr/bin/sandbox-exec",
  "-p",
  '(version 1)(deny default)(allow process-exec)(import "/System/Library/Sandbox/Profiles/dyld-support.sb")',
  "/usr/bin/true",
])
if (probe.exitCode !== 0)
  throw new Error(
    `Seatbelt enforcement tests cannot run here: ${probe.stderr.toString().trim()}. Run outside any enclosing restrictive sandbox.`,
  )

await using temporary = await tmpdir("opencode-sandbox-validation-")
const report = path.join(temporary.path, "results.xml")
const files = (await Array.fromAsync(new Bun.Glob("test/sandbox-*.test.ts").scan({ cwd: process.cwd() }))).sort()
if (files.length === 0) throw new Error("Run sandbox validation from packages/core")
const child = Bun.spawn(
  [process.execPath, "run", "script/test.ts", ...files, "--reporter=junit", `--reporter-outfile=${report}`],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
)
const interrupt = () => child.kill("SIGINT")
const terminate = () => child.kill("SIGTERM")
process.once("SIGINT", interrupt)
process.once("SIGTERM", terminate)
const code = await child.exited
process.off("SIGINT", interrupt)
process.off("SIGTERM", terminate)
if (code !== 0) process.exitCode = code
else {
  const xml = await fs.readFile(report, "utf8")
  const suites = [...xml.matchAll(/<testsuite\b[^>]*\bskipped="(\d+)"/g)]
  if (suites.length === 0 || suites.some((suite) => Number(suite[1]) !== 0))
    throw new Error(
      "Incomplete sandbox enforcement run: skipped tests or missing results. Provision the tested runtimes and run on a normal macOS host.",
    )
  console.log("Sandbox enforcement validation passed without skips.")
}

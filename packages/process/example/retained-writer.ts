import { Effect } from "effect"
import { ForegroundProcess } from "../src/process.ts"

const executable = Bun.which("node")
if (!executable) throw new Error("Node is required for this example")

const started = performance.now()
const result = await Effect.runPromise(
  ForegroundProcess.run({
    executable,
    args: [
      "-e",
      `
    const fs = require('node:fs')
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true, stdio: 'inherit'
    })
    child.unref()
    fs.writeSync(1, String(child.pid) + '\\n')
    fs.writeSync(1, Buffer.alloc(1048576, 120))
    fs.writeSync(2, 'stderr tail')
  `,
    ],
  }),
)

const descendant = Number(result.stdout.toString("utf8", 0, result.stdout.indexOf(10)))
try {
  process.kill(descendant, 0)
  console.log({
    exitCode: result.exitCode,
    stdoutBytes: result.stdout.length,
    stderr: result.stderr.toString(),
    descendantStillRunning: true,
    elapsedMs: Math.round(performance.now() - started),
  })
} finally {
  process.kill(descendant)
}

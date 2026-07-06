#!/usr/bin/env bun

import path from "path"

const root = path.resolve(import.meta.dir, "..")
const proc = Bun.spawn(
  [
    "bun",
    "turbo",
    "typecheck",
    "--concurrency=1",
    "--force",
    "--continue=always",
    "--summarize",
    "--output-logs=errors-only",
  ],
  {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  },
)
const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
const output = stdout + stderr
if (exitCode !== 0) {
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  process.exit(exitCode)
}

const summary = output.match(/Summary:\s+(.+\.json)/)?.[1]?.trim()
if (!summary) {
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  throw new Error("Turbo did not report a run summary")
}

const report = (await Bun.file(summary).json()) as {
  tasks: Array<{
    taskId: string
    execution: { startTime: number; endTime: number; exitCode: number } | null
  }>
}
const tasks = report.tasks
  .flatMap((task) =>
    task.execution
      ? [
          {
            task: task.taskId.replace(/#typecheck$/, ""),
            durationMs: task.execution.endTime - task.execution.startTime,
          },
        ]
      : [],
  )
  .sort((a, b) => b.durationMs - a.durationMs)
const total = tasks.reduce((duration, task) => duration + task.durationMs, 0)
const width = Math.max(...tasks.map((task) => task.task.length), "Package".length)

console.log(`Package${" ".repeat(width - "Package".length)}  Time    Share`)
tasks.forEach((task) => {
  const duration = `${(task.durationMs / 1000).toFixed(2)}s`.padStart(7)
  const share = `${((task.durationMs / total) * 100).toFixed(1)}%`.padStart(6)
  console.log(`${task.task.padEnd(width)}  ${duration}  ${share}`)
})
console.log(`\nTotal serial task time: ${(total / 1000).toFixed(2)}s`)
console.log(`Turbo summary: ${path.relative(root, summary)}`)

import { expect, test } from "bun:test"
import { Effect } from "effect"
import { constants, getPriority, setPriority } from "node:os"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"
import { ProcessPriority } from "../src/process-priority"

const windows = process.platform === "win32"

test("raises this process above normal priority on Windows only, and a process it starts stays at normal", () => {
  const before = getPriority()
  try {
    expect(ProcessPriority.raise()).toBe(windows)
    expect(getPriority()).toBe(windows ? constants.priority.PRIORITY_ABOVE_NORMAL : before)
    const child = Bun.spawnSync(
      [process.execPath, "-e", "process.stdout.write(String(require('node:os').getPriority()))"],
      { stdout: "pipe", stderr: "pipe" },
    )
    expect(child.stderr.toString()).toBe("")
    // Windows starts a process at the normal class unless its parent runs below normal. Elsewhere a process takes its
    // parent's niceness, which did not change.
    expect(Number(child.stdout.toString())).toBe(windows ? constants.priority.PRIORITY_NORMAL : before)
  } finally {
    setPriority(before)
  }
})

// A release build, where a flag is off until the configuration turns it on.
const boot = (input: { priority?: boolean; flag?: boolean }) =>
  Effect.gen(function* () {
    const config = yield* tmpdirScoped("opencode-server-priority-")
    yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version", channel: "latest" },
      database: { path: ":memory:" },
      config: {
        directory: config.path,
        content: JSON.stringify(input.flag ? { experimental: { server_priority: true } } : {}),
      },
      fs: { filewatcher: false },
      models: { fetch: false },
      priority: input.priority,
    })

    return getPriority()
  }).pipe(Effect.scoped)

it.live(
  "a server raises its process only when it owns the process and the flag is on",
  () => {
    const before = getPriority()

    return Effect.gen(function* () {
      expect(yield* boot({ priority: true })).toBe(before)
      expect(yield* boot({ flag: true })).toBe(before)
      expect(yield* boot({ priority: true, flag: true })).toBe(
        windows ? constants.priority.PRIORITY_ABOVE_NORMAL : before,
      )
    }).pipe(Effect.ensuring(Effect.sync(() => setPriority(before))))
  },
  // Three servers start and stop.
  { timeout: 30_000 },
)

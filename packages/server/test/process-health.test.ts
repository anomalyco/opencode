import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"

for (const phase of ["ready", "failed"]) {
  it.live(
    `historical health probes preserve identity and authentication during starting and ${phase}`,
    () =>
      Effect.gen(function* () {
        // Global paths are captured at import time. Boot the real graph only after
        // giving its process an isolated home, config, database and cache.
        const root = yield* tmpdirScoped("opencode-process-health-")
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/process-health.ts"), phase], {
              cwd: root.path,
              env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                WINDIR: process.env.WINDIR,
                HOME: root.path,
                USERPROFILE: root.path,
                OPENCODE_TEST_HOME: root.path,
                XDG_CONFIG_HOME: path.join(root.path, "config"),
                XDG_DATA_HOME: path.join(root.path, "data"),
                XDG_CACHE_HOME: path.join(root.path, "cache"),
                XDG_STATE_HOME: path.join(root.path, "state"),
                TMPDIR: root.path,
                TMP: root.path,
                TEMP: root.path,
              },
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
            }),
          ),
          (child) =>
            Effect.promise(async () => {
              if (child.exitCode === null) child.kill("SIGKILL")
              await child.exited
            }),
        )
        const result = yield* Effect.promise(async () => {
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ])
          return { code, stdout, stderr }
        }).pipe(Effect.timeout("20 seconds"))
        expect(result.code, result.stdout + result.stderr).toBe(0)
        expect(result.stdout).toContain(`health compatibility passed: ${phase}`)
      }),
    25_000,
  )
}

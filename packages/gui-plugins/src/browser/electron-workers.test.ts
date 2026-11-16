import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"

// A tab pauses its page's children at start to guard them (`attachChildren` in child-targets.ts). Chromium pauses the
// page's workers too, so this runs the policy in the pinned Electron: a worker the tab does not release never starts.
test.each([
  { fixture: "electron-workers", expected: { started: "nested,worker" } },
  { fixture: "profile/filter-startup", expected: { worker: true, emptyRules: true } },
])("the pinned Electron honors $fixture", async ({ fixture, expected }) => {
  const out = await mkdtemp(path.join(tmpdir(), "electron-workers-"))

  try {
    const built = await Bun.build({
      entrypoints: [path.join(import.meta.dir, `${fixture}.fixture.ts`)],
      outdir: out,
      target: "node",
      format: "cjs",
      naming: "[name].cjs",
      external: ["electron"],
    })

    if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")

    const child = Bun.spawn(
      [
        String(electron),
        `--user-data-dir=${path.join(out, "profile")}`,
        // CI's Linux runners have no display, and node_modules' chrome-sandbox is not set up as root.
        ...(process.platform === "linux" ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"] : []),
        path.join(out, `${path.basename(fixture)}.fixture.cjs`),
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    const line = stdout.split("\n").find((text) => text.startsWith("{"))

    if (!line) throw new Error(`Electron printed no result (exit ${code}).\n${stderr}`)

    expect(JSON.parse(line)).toEqual(expected)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}, // Starting Electron takes seconds on a loaded runner.
60_000)

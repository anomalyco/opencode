import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

// Runs an Electron main-process fixture of a real-Electron test (`*.fixture.ts`) in the pinned Electron, for every such
// test in this package. The binary is installed on first use, by whichever process asks first: other suites that run
// alongside (desktop's) may be extracting it while a test here starts, which Linux reports as ETXTBSY at spawn.

// Electron's main script. It is plain CommonJS that cannot fail to load, so it holds every failure of the fixture's
// bundle, including one that does not parse: each ends the process with its reason in the log, and Electron never
// opens its error box on the desktop.
const loader = `"use strict"
const { appendFileSync } = require("node:fs")
const { app, dialog } = require("electron")
const fail = (reason) => {
  try {
    appendFileSync(process.env.ELECTRON_FIXTURE_LOG, String((reason && reason.stack) || reason) + "\\n")
  } catch {}
  app.exit(1)
}
dialog.showErrorBox = () => {}
process.on("uncaughtException", fail)
process.on("unhandledRejection", fail)
try {
  import("file:///" + process.env.ELECTRON_FIXTURE_ENTRY.replace(/\\\\/g, "/").replace(/^\\//, "")).catch(fail)
} catch (error) {
  fail(error)
}
`

/** The fixture's one JSON line; otherwise a failure with its exit code, its log and its stderr. */
export async function runElectronFixture(input: {
  /** Absolute path to the fixture's source. */
  readonly fixture: string
  readonly env?: Readonly<Record<string, string>>
}) {
  const out = await mkdtemp(path.join(tmpdir(), `${path.basename(input.fixture, ".fixture.ts")}-`))

  try {
    const log = path.join(out, "fixture.log")
    await writeFile(path.join(out, "loader.cjs"), loader)

    // ES modules in chunks: dependencies of the pane use `import.meta`.
    const built = await Bun.build({
      entrypoints: [input.fixture],
      outdir: out,
      target: "node",
      format: "esm",
      splitting: true,
      naming: { entry: "fixture.mjs", chunk: "[name]-[hash].mjs" },
      external: ["electron"],
    })

    if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")

    const child = await spawn(
      [
        await electronBinary(),
        `--user-data-dir=${path.join(out, "profile")}`,
        // CI's Linux runners have no display, and node_modules' chrome-sandbox is not set up as root.
        ...(process.platform === "linux" ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"] : []),
        path.join(out, "loader.cjs"),
      ],
      {
        ...process.env,
        ...input.env,
        ELECTRON_RUN_AS_NODE: undefined,
        ELECTRON_ENABLE_LOGGING: undefined,
        ELECTRON_FIXTURE_LOG: log,
        ELECTRON_FIXTURE_ENTRY: path.join(out, "fixture.mjs"),
      },
    )

    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const line = stdout.split("\n").find((text) => text.startsWith("{"))

    if (line) return line
    const failure = await readFile(log, "utf8").catch(() => "")

    throw new Error(`Electron printed no result (exit ${code}).\n${failure}\n${stderr}`)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}

/**
 * The pinned Electron's executable. Electron's package downloads and extracts it on first import, so one process at a
 * time imports it, behind a lock directory next to the package. A lock left by a crashed run expires.
 */
async function electronBinary() {
  const lock = path.join(path.dirname(createRequire(import.meta.url).resolve("electron/package.json")), ".opencode-install.lock")
  const deadline = Date.now() + 180_000

  while (!(await mkdir(lock).then(() => true, () => false))) {
    const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0)

    if (age > 600_000) await rm(lock, { recursive: true, force: true })

    if (Date.now() > deadline) throw new Error(`Another process held ${lock} for 3 minutes.`)
    await Bun.sleep(200)
  }

  try {
    const { default: binary } = await import("electron")

    return String(binary)
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

/** Another suite's install may hold the binary open for writing for a moment after this one found it in place. */
async function spawn(command: string[], env: Readonly<Record<string, string | undefined>>) {
  const deadline = Date.now() + 10_000

  for (let wait = 50; ; wait = Math.min(wait * 2, 1_000)) {
    try {
      // Ended before the test's own 60 s timeout, so no Electron outlives its test.
      return Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe", timeout: 55_000 })
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("ETXTBSY")) || Date.now() + wait > deadline) throw error
      await Bun.sleep(wait)
    }
  }
}

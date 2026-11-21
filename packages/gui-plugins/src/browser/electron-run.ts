import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import type { CustomScheme } from "electron"

// Runs an Electron main-process fixture of a real-Electron test (`*.fixture.ts`) in the pinned Electron, for every such
// test in this package. The binary is installed on first use, by whichever process asks first: other suites that run
// alongside (desktop's) may be extracting it while a test here starts, which Linux reports as ETXTBSY at spawn.

// Electron's main script. It is plain CommonJS that cannot fail to load, so it holds every failure of the fixture's
// bundle, including one that does not parse: each ends the process with its reason in the log, and Electron never
// opens its error box on the desktop.
const loader = `"use strict"
const { appendFileSync } = require("node:fs")
const { app, dialog, protocol } = require("electron")
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
  // Scheme privileges exist only when granted before the app is ready, which a fixture loaded here may miss.
  if (process.env.ELECTRON_FIXTURE_SCHEMES) protocol.registerSchemesAsPrivileged(JSON.parse(process.env.ELECTRON_FIXTURE_SCHEMES))
  import("file:///" + process.env.ELECTRON_FIXTURE_ENTRY.replace(/\\\\/g, "/").replace(/^\\//, "")).catch(fail)
} catch (error) {
  fail(error)
}
`

/**
 * A file imported with `?raw` is its text, as the app's bundler reads it: the profile ships its page scripts so.
 */
const rawText: Bun.BunPlugin = {
  name: "raw-text",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(path.dirname(args.importer), args.path.slice(0, -"?raw".length)),
      namespace: "raw-text",
    }))
    build.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
      contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))}`,
      loader: "js",
    }))
  },
}

/** The fixture's one JSON line; otherwise a failure with its exit code, its log and its stderr. */
export async function runElectronFixture(input: {
  /** Absolute path to the fixture's source. */
  readonly fixture: string
  readonly env?: Readonly<Record<string, string>>
  /** Schemes the product registers as privileged before the app is ready (`src/schemes.ts`). */
  readonly schemes?: readonly CustomScheme[]
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
      plugins: [rawText],
    })

    if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")

    const binary = await electronBinary()

    const launch = async (attempt: number): Promise<string> => {
      await settled()

      const child = await spawn(
        [
          binary,
          `--user-data-dir=${path.join(out, `profile-${attempt}`)}`,
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
        ELECTRON_FIXTURE_SCHEMES: input.schemes ? JSON.stringify(input.schemes) : undefined,
        },
      )

      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split("\n").find((text) => text.startsWith("{"))

      if (line) return line
      const failure = await readFile(log, "utf8").catch(() => "")

      // Killed by a signal before the loader ran, as Chromium is when another suite's install rewrites its files under
      // it. Launch once more once the files have settled; a fixture's own failure is logged and never retried.
      if (attempt === 0 && !failure && code > 128) return launch(1)

      throw new Error(`Electron printed no result (exit ${code}).\n${failure}\n${stderr}`)
    }

    return await launch(0)
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

/**
 * Waits until no file of the Electron distribution changed for 2 seconds: another suite may still be extracting it
 * after this one found the executable in place.
 */
async function settled() {
  const directory = path.join(path.dirname(createRequire(import.meta.url).resolve("electron/package.json")), "dist")
  const deadline = Date.now() + 60_000

  for (;;) {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })

    const times = await Promise.all(
      entries.filter((entry) => entry.isFile()).map((entry) => stat(path.join(entry.parentPath, entry.name)).then((info) => info.mtimeMs, () => Date.now())),
    )

    const quiet = Date.now() - Math.max(0, ...times)

    if (quiet >= 2_000 || Date.now() > deadline) return
    await Bun.sleep(2_000 - quiet)
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

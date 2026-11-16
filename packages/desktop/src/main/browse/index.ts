export * as Browse from "./index"

import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { net } from "electron"
import { Cause, Context, Duration, Effect, Exit, FiberSet, Layer, Option } from "effect"
import type { BrowseInstallFailure, BrowseStatus } from "../../shared/ipc-contract"
import {
  browseInstallJob,
  initialBrowseInstallState,
  transitionBrowseInstall,
  type BrowseInstallCommand,
  type BrowseInstallEvent,
} from "./install-machine"
import { installerError } from "./installer-error"
import { browseBinaries, readBrowseSetup } from "./status"

export interface Interface {
  readonly status: Effect.Effect<BrowseStatus>
  /** Starts the installer unless one is running; `status` reports how it went. */
  readonly install: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Browse") {}

const INSTALLER_URL = "https://opencode.ai/browse/install"

const WINDOWS_INSTALLER_URL = "https://opencode.ai/browse/install.ps1"

// `browse install` sets up OpenCode, opens the Chrome Web Store (or the extension's pairing page) and waits for the
// browser to connect. The wait covers finding and adding the extension; the timeout bounds a hung download.
const WAIT_SECONDS = 600

const INSTALL_TIMEOUT = Duration.minutes(12)

const SETUP_ARGS = ["--agent", "opencode", "--wait-seconds", String(WAIT_SECONDS)]

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fibers = yield* FiberSet.make()
    const run = yield* FiberSet.runtime(fibers)()
    const current = { state: initialBrowseInstallState() }

    const dispatch = (event: BrowseInstallEvent) => {
      const next = transitionBrowseInstall(current.state, event)
      current.state = next.state
      next.commands.forEach(perform)
    }

    const perform = (command: BrowseInstallCommand) => {
      const attempt = command.attempt

      void run(
        runInstaller.pipe(
          Effect.timeoutOrElse({
            duration: INSTALL_TIMEOUT,
            orElse: () => Effect.fail<BrowseInstallFailure>({ reason: "timeout" }),
          }),
          Effect.exit,
          Effect.flatMap((exit) => {
            if (Exit.isSuccess(exit)) return Effect.sync(() => dispatch({ type: "install.succeeded", attempt }))

            if (Cause.hasInterruptsOnly(exit.cause)) return Effect.void

            const failure = Option.getOrElse(
              Cause.findErrorOption(exit.cause),
              (): BrowseInstallFailure => ({
                reason: "installer",
              }),
            )

            return Effect.logError("browse installation failed", { failure, cause: Cause.pretty(exit.cause) }).pipe(
              Effect.andThen(Effect.sync(() => dispatch({ type: "install.failed", attempt, failure }))),
            )
          }),
        ),
      )
    }

    yield* Effect.addFinalizer(() => Effect.sync(() => dispatch({ type: "disposed" })))

    return Service.of({
      status: Effect.promise(() => readBrowseSetup(browseBinaries(process.platform, homedir(), process.env))).pipe(
        Effect.map((setup) => ({ ...setup, job: browseInstallJob(current.state) })),
      ),
      install: Effect.sync(() => dispatch({ type: "install.requested" })),
    })
  }),
)

const runInstaller = Effect.gen(function* () {
  const windows = process.platform === "win32"

  const script = yield* Effect.tryPromise({
    try: async () => {
      const response = await net.fetch(windows ? WINDOWS_INSTALLER_URL : INSTALLER_URL)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      return response.text()
    },
    catch: (): BrowseInstallFailure => ({ reason: "download" }),
  })

  if (!windows) return yield* spawnInstaller("/bin/sh", ["-s", "--", ...SETUP_ARGS], script)

  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(path.join(tmpdir(), "opencode-browse-")),
      catch: (): BrowseInstallFailure => ({ reason: "installer" }),
    }),
    (dir) =>
      Effect.tryPromise({
        try: () => writeFile(path.join(dir, "install.ps1"), script),
        catch: (): BrowseInstallFailure => ({ reason: "installer" }),
      }).pipe(
        Effect.andThen(
          spawnInstaller("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.join(dir, "install.ps1"),
            ...SETUP_ARGS,
          ]),
        ),
      ),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  )
})

function spawnInstaller(command: string, args: readonly string[], stdin?: string) {
  return Effect.callback<void, BrowseInstallFailure>((resume) => {
    const child = spawn(command, args, {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })

    let output = ""

    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_000)
    }

    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", (error) => resume(Effect.fail({ reason: "installer", detail: error.message })))
    child.on("close", (code) => {
      if (code === 0) return resume(Effect.void)

      const detail = installerError(output)

      resume(Effect.fail(detail ? { reason: "installer", detail } : { reason: "installer" }))
    })
    // The shell can exit before it read the whole script; its `close` reports the failure.
    child.stdin.on("error", () => {})
    child.stdin.end(stdin)

    return Effect.sync(() => child.kill())
  })
}

import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { toStringUnknown } from "effect/Inspectable"
import { initializeInstance } from "../instance/instance.js"
import * as DriveProcess from "../instance/process.js"
import * as OpenCodeInstance from "../instance/runtime.js"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import * as SimulationConnector from "../simulation/connector.js"
import { connectMockBackend } from "./mock-backend.js"
import { createResponseSettings } from "./response-generator.js"
import { loadScript, runScript } from "./script.js"
import type { ScriptDefinition } from "../script/types.js"
import { prepareScriptModule } from "../script/tooling.js"
import { finalizeRecording } from "../recording/finalize.js"
import { listenControl } from "../instance/control.js"
import { configureLogFile, logError, logReadyPaths, logSuccess } from "../log.js"
import {
  controlPath,
  markReady,
  markStarting,
  initializeManifest,
  register,
  registryDirectory,
  resolveInstance,
  unregister,
} from "../instance/registry.js"
import type { StartOptions } from "./types.js"

export const start = Effect.fn("DriveCli.start")((options: StartOptions) => Effect.scoped(startScoped(options)))

const startScoped = Effect.fn("DriveCli.startScoped")(function* (options: StartOptions) {
  const initializerPid = Number.parseInt(options.daemon ? (process.env.OPENCODE_DRIVE_INITIALIZER_PID ?? "") : "", 10)
  if (options.daemon) delete process.env.OPENCODE_DRIVE_INITIALIZER_PID
  const initialized = yield* fromPromise(() =>
    initializeManifest(options.name, process.cwd(), () => initializeInstance(options.name), {
      temporary: true,
      ...(Number.isInteger(initializerPid) && initializerPid > 0 ? { adoptPid: initializerPid } : {}),
    }),
  )
  configureLogFile(initialized.artifacts)
  logSuccess(`starting ${options.name}`)
  logSuccess(`using artifacts ${initialized.artifacts}`)
  if (!options.visible && !options.script && !options.daemon)
    return yield* startDetached(options, initialized.artifacts)
  const scriptPath = options.script
  const scriptModule = scriptPath
    ? yield* fromPromise(async () => {
        logSuccess(`preparing script ${scriptPath}`)
        return prepareScriptModule(initialized.artifacts, scriptPath)
      })
    : undefined
  const script = scriptModule
    ? yield* loadScript(scriptModule).pipe(
        Effect.tap(() => Effect.sync(() => logSuccess(`loading script ${scriptModule}`))),
      )
    : undefined
  if (script && "launch" in script && options.record) {
    return yield* Effect.fail(new Error("--record is not supported when launch is manual"))
  }
  const responses = createResponseSettings()
  logSuccess("launching instance")
  const log = options.visible ? (message: string) => logSuccess(message, { terminal: false }) : logSuccess
  const instance = yield* OpenCodeInstance.make({
    artifacts: initialized.artifacts,
    name: options.name,
    command: options.command,
    dev: options.dev,
    scripted: options.script !== undefined,
    visible: options.visible,
    record: options.record,
    viewport: script?.tui?.viewport,
    project: script?.project,
    config: script?.config,
    tui: script?.tuiConfig,
    setup: script?.setup,
    tools: script?.tools,
    log,
  })
  yield* Effect.acquireRelease(
    fromPromise(() =>
      register({
        version: 1,
        name: options.name,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        cwd: process.cwd(),
        artifacts: instance.artifacts,
        visible: options.visible,
        status: "starting",
        endpoints: instance.endpoints,
        control: controlPath(options.name),
      }),
    ),
    () => fromPromise(() => unregister(options.name, process.pid)).pipe(Effect.ignore),
  )
  return yield* lifecycle(options, instance, responses, script, log)
})

function lifecycle(
  options: StartOptions,
  instance: OpenCodeInstance.Instance,
  responses: ReturnType<typeof createResponseSettings>,
  script: ScriptDefinition | undefined,
  log: (message: string) => void,
) {
  return Effect.callback<void, unknown>((resume) => {
    const abort = new AbortController()
    const promise = runLifecycle(options, instance, responses, script, log, abort.signal)
    void promise.then(
      () => resume(Effect.void),
      (error) => resume(Effect.fail(error)),
    )
    return Effect.gen(function* () {
      abort.abort(new Error("opencode-drive interrupted"))
      yield* Effect.promise(() => promise.catch(() => undefined))
    })
  })
}

async function runLifecycle(
  options: StartOptions,
  instance: OpenCodeInstance.Instance,
  responses: ReturnType<typeof createResponseSettings>,
  script: ScriptDefinition | undefined,
  log: (message: string) => void,
  signal: AbortSignal,
) {
  let completed = false
  let current: ReturnType<typeof run> | undefined
  let restarting: Promise<string | undefined> | undefined
  let stopping = false
  const screenshots: string[] = []
  const recordings: string[] = []
  let driveReady = false
  let recording: Promise<string | undefined> | undefined
  const finishCurrentRecording = (onProgress?: (percent: number) => void) => {
    if (!options.record || options.visible || !driveReady || options.script !== undefined)
      return Promise.resolve(undefined)
    recording ??= finishRecording(instance, onProgress)
    return recording
  }
  const interrupt = () => {
    stopping = true
    current?.abort.abort(signal.reason)
    if (!options.script) void stopInstance().catch((error) => logError(`failed to stop interrupted instance: ${error}`))
  }
  signal.addEventListener("abort", interrupt, { once: true })
  const stopInstance = async (onProgress?: (percent: number) => void) => {
    try {
      const output = await finishCurrentRecording(onProgress)
      return {
        ...(output ? { recording: output } : {}),
        screenshots: [...screenshots],
      }
    } finally {
      stopping = true
      current?.abort.abort(new Error("opencode-drive stopped"))
      await runEffect(instance.stop)
    }
  }
  const completeScript = async () => {
    completed = true
    const result = await stopInstance()
    for (const screenshot of result.screenshots) console.log(screenshot)
  }
  let closeControl: (() => Promise<void>) | undefined
  let failure: unknown
  try {
    closeControl = await listenControl(controlPath(options.name), {
      restart: () => {
        if (restarting) return restarting
        restarting = (async () => {
          await markStarting(options.name, process.pid)
          const output = await finishCurrentRecording()
          const previous = current
          const restartReason = new Error("script restarted")
          previous?.abort.abort(restartReason)
          await previous?.promise
          driveReady = false
          await runEffect(instance.restart)
          recording = undefined
          current = run(
            options,
            instance,
            responses,
            script,
            (path) => screenshots.push(path),
            (path) => recordings.push(path),
            log,
          )
          await current.ready
          driveReady = true
          await markReady(options.name, process.pid)
          await logReadyPaths(instance.artifacts, {
            terminal: !options.visible,
          })
          return output
        })().finally(() => {
          restarting = undefined
        })
        return restarting
      },
      stop: stopInstance,
      responses: async (input) => {
        if (options.script) throw new Error("responses are unavailable when --script owns the simulation backend")
        return responses.update(input)
      },
    })
    if (signal.aborted) return
    current = run(
      options,
      instance,
      responses,
      script,
      (path) => screenshots.push(path),
      (path) => recordings.push(path),
      log,
    )
    await current.ready
    driveReady = true
    log(`ready ${options.name}`)
    await markReady(options.name, process.pid)
    await logReadyPaths(instance.artifacts, { terminal: !options.visible })
    if (options.visible) {
      while (true) {
        const active: NonNullable<typeof current> = current
        let result: { readonly script: true } | { readonly script: false; readonly status: number }
        try {
          result = options.script
            ? await Promise.race([
                active.promise.then(() => ({ script: true as const })),
                runEffect(instance.wait).then((status) => ({ script: false as const, status })),
              ])
            : { script: false as const, status: await runEffect(instance.wait) }
        } catch (error) {
          if (stopping) return
          if (restarting || active !== current) {
            await restarting
            continue
          }
          throw error
        }
        if (restarting || active !== current) {
          await restarting
          continue
        }
        if (result.script) {
          await completeScript()
        }
        const status = result.script ? await runEffect(instance.wait) : result.status
        if (status !== 0 && !stopping) process.exitCode = status
        return
      }
    }
    while (true) {
      const active: NonNullable<typeof current> = current
      try {
        await active.promise
      } catch (error) {
        if (stopping) break
        if (restarting || active !== current) {
          await restarting
          continue
        }
        throw error
      }
      if (stopping) break
      if (restarting) {
        await restarting
        continue
      }
      if (active !== current) continue
      if (options.script) {
        await completeScript()
        break
      }
      completed = true
      break
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    signal.removeEventListener("abort", interrupt)
    current?.abort.abort(new Error("opencode-drive stopped"))
    let cleanupFailure: unknown
    const recordingPath = await finishCurrentRecording().catch((error) => {
      logError(`failed to export recording: ${error}`)
      return undefined
    })
    await closeControl?.().catch((error) => {
      cleanupFailure ??= error
      logError(`failed to close control socket: ${error}`)
    })
    await runEffect(instance.stop).catch((error) => {
      cleanupFailure ??= error
      logError(`failed to stop OpenCode: ${error}`)
    })
    await unregister(options.name, process.pid).catch((error) => {
      cleanupFailure ??= error
      logError(`failed to unregister ${options.name}: ${error}`)
    })
    if (options.script && !options.visible) report(completed ? "completed" : undefined)
    if (options.script && recordingPath) logSuccess(`recording ${recordingPath}`)
    if (options.script) for (const output of recordings) logSuccess(`recording ${output}`)
    if (shouldCleanArtifacts(options.script, completed, failure, cleanupFailure))
      await rm(instance.artifacts, { recursive: true, force: true }).catch((error) => {
        cleanupFailure ??= error
        logError(`failed to clean artifacts ${instance.artifacts}: ${error}`)
      })
    if (options.script && failure !== undefined) {
      logError(failure instanceof Error ? failure.message : toStringUnknown(failure))
      process.exit(1)
    }
    if (failure === undefined && cleanupFailure !== undefined) process.exitCode = 1
  }
}

function shouldCleanArtifacts(
  script: string | undefined,
  completed: boolean,
  failure: unknown,
  cleanupFailure: unknown,
) {
  return (
    script !== undefined &&
    completed &&
    failure === undefined &&
    cleanupFailure === undefined &&
    (process.exitCode === undefined || process.exitCode === 0) &&
    process.env.OPENCODE_DRIVE_KEEP_ARTIFACTS !== "1"
  )
}

async function finishRecording(instance: OpenCodeInstance.Instance, onProgress?: (percent: number) => void) {
  const expected = await runEffect(instance.recording)
  if (!expected) throw new Error("recording was not enabled for this instance")
  let timeline: string
  const process = await runEffect(instance.primary)
  if (!(await runEffect(process.isRunning))) {
    timeline = expected.timeline
  } else {
    timeline = await runEffect(
      Effect.scoped(
        SimulationConnector.ui(instance.endpoints.ui, {
          connectTimeout: 60_000,
        }).pipe(
          Effect.flatMap((connection) => connection.rpc["ui.recording.finish"]()),
          Effect.timeoutOrElse({
            duration: 60_000,
            orElse: () => Effect.fail(new Error("ui.recording.finish timed out")),
          }),
        ),
      ),
    )
  }
  return finalizeRecording(timeline, expected, { onProgress })
}

const startDetached = Effect.fn("DriveCli.startDetached")(function* (options: StartOptions, artifacts: string) {
  const ownerLog = join(registryDirectory(), `${options.name}.log`)
  yield* fromPromise(() => mkdir(registryDirectory(), { recursive: true }))
  yield* fromPromise(() => rm(ownerLog, { force: true }))
  logSuccess(`launching detached owner for ${options.name}`)
  const child = yield* DriveProcess.spawn(
    [
      process.execPath,
      process.argv[1]!,
      "start",
      "--daemon",
      "--name",
      options.name,
      ...(options.script ? ["--script", options.script] : []),
      ...(options.dev ? ["--dev", options.dev] : []),
      ...(options.record ? ["--record"] : []),
      ...(options.command.length ? ["--", ...options.command] : []),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENCODE_DRIVE_LOG: configureLogFile(artifacts),
        OPENCODE_DRIVE_OWNER_LOG: ownerLog,
        OPENCODE_DRIVE_INITIALIZER_PID: String(process.pid),
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    },
  )
  logSuccess(`waiting for ${options.name} to become ready`)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const manifest = yield* fromPromise(() => resolveInstance(options.name).catch(() => undefined))
    if (manifest?.pid === child.pid) {
      logSuccess(`ready ${options.name}`)
      yield* fromPromise(() => logReadyPaths(manifest.artifacts))
      yield* child.detach
      return
    }
    if (!(yield* child.isRunning)) {
      const status = yield* child.exitCode
      yield* Effect.fail(new Error(`detached instance exited with status ${status}; see ${ownerLog}`))
    }
    yield* Effect.sleep(50)
  }
  yield* child.terminate
  yield* Effect.fail(new Error(`timed out starting drive instance "${options.name}"; see ${ownerLog}`))
})

function run(
  options: StartOptions,
  instance: OpenCodeInstance.Instance,
  responses: ReturnType<typeof createResponseSettings>,
  driveScript: ScriptDefinition | undefined,
  onScreenshot: (path: string) => void,
  onRecording: (path: string) => void,
  log: (message: string) => void,
) {
  const abort = new AbortController()
  const readiness = Promise.withResolvers<void>()
  let markedReady = false
  const ready = () => {
    if (markedReady) return
    markedReady = true
    readiness.resolve()
  }
  const promise = (async () => {
    if (!driveScript) {
      log("waiting for OpenCode")
      await runEffect(instance.waitForDrive("both"))
      log("OpenCode ready")
    }
    if (driveScript) {
      log("running script")
      const exit = await Effect.runPromiseExit(
        Effect.scoped(runScript(driveScript, instance, onScreenshot, onRecording, ready)),
        { signal: abort.signal },
      )
      if (Exit.isFailure(exit)) {
        if (abort.signal.aborted && Cause.hasInterruptsOnly(exit.cause)) return
        throw Cause.squash(exit.cause)
      }
      ready()
      log("script completed")
      return
    }
    const child = await runEffect(instance.primary)
    const mock = await connectMockBackend(instance.endpoints.backend, responses)
    ready()
    abort.signal.addEventListener("abort", () => mock.close(), {
      once: true,
    })
    const status = await Promise.race([
      runEffect(child.exitCode),
      new Promise<number>((resolve) =>
        abort.signal.addEventListener("abort", () => resolve(0), {
          once: true,
        }),
      ),
    ])
    mock.close()
    if (status !== 0 && !abort.signal.aborted) process.exitCode = status
  })().catch((error) => {
    if (!markedReady) readiness.reject(error)
    throw error
  })
  void promise.catch(() => undefined)
  return {
    abort,
    ready: readiness.promise,
    promise,
  }
}

const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const fromPromise = <A>(task: () => Promise<A>) => Effect.tryPromise({ try: task, catch: (error) => error })

function report(status?: string) {
  if (status) logSuccess(status)
}

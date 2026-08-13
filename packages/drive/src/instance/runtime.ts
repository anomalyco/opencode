import { join, resolve } from "node:path"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"
import * as Scope from "effect/Scope"
import { ChildProcessSpawner } from "effect/unstable/process"
import { prepareDev } from "./dev.js"
import { instanceError, OpenCodeInstanceError } from "./error.js"
import { runMediaDirectory } from "./media.js"
import { prepareInstanceProject } from "./instance.js"
import * as Process from "./process.js"
import { freePort, waitForWebSocket } from "./readiness.js"
import { isValidName } from "./registry.js"
import { stopService } from "./service.js"
import type { RecordingPaths } from "../recording/finalize.js"
import { stripGitEnvironment } from "../script/project.js"
import * as ToolController from "../tool/controller.js"
import type * as Tool from "../tool/index.js"
import type { Frontend } from "../client/protocol.js"
import type { OpenCodeConfig, OpenCodeTuiConfig, Project, Setup } from "../project.js"

type Viewport = Frontend.ResizeParams

export { OpenCodeInstanceError } from "./error.js"

export interface Options {
  readonly artifacts: string
  readonly name: string
  readonly command?: ReadonlyArray<string>
  readonly dev?: string
  readonly scripted?: boolean
  readonly visible?: boolean
  readonly record?: boolean
  readonly viewport?: Viewport
  readonly env?: Readonly<Record<string, string>>
  readonly project?: Project
  readonly config?: OpenCodeConfig
  readonly tui?: OpenCodeTuiConfig
  readonly setup?: Setup
  readonly tools?: Tool.Configuration
  readonly log?: (message: string) => void
}

export interface TuiProcess {
  readonly endpoint: string
  readonly process: Process.Running
  readonly recording?: RecordingPaths
  readonly close: Effect.Effect<void, OpenCodeInstanceError>
}

export interface Instance {
  readonly artifacts: string
  readonly logs: string
  readonly visible: boolean
  readonly endpoints: {
    readonly ui: string
    readonly backend: string
  }
  readonly tools: Tool.StaticControls
  readonly toolNames: ReadonlySet<string>
  readonly recording: Effect.Effect<RecordingPaths | undefined>
  readonly primary: Effect.Effect<Process.Running, OpenCodeInstanceError>
  readonly launchServer: Effect.Effect<{ readonly endpoint: string }, OpenCodeInstanceError>
  readonly killServer: Effect.Effect<void, OpenCodeInstanceError>
  readonly launchTui: (
    name: string,
    options?: { readonly record?: boolean; readonly viewport?: Viewport },
  ) => Effect.Effect<TuiProcess, OpenCodeInstanceError>
  readonly waitForDrive: (
    requirement?: "ui" | "backend" | "both",
    timeout?: number,
  ) => Effect.Effect<void, OpenCodeInstanceError>
  readonly restart: Effect.Effect<void, OpenCodeInstanceError>
  readonly wait: Effect.Effect<number, OpenCodeInstanceError>
  readonly stop: Effect.Effect<void, OpenCodeInstanceError>
}

interface StateFields {
  readonly recording?: RecordingPaths
  readonly server?: Process.Running
  readonly pendingServer?: Process.Running
  readonly primary?: Process.Running
  readonly tuis: ReadonlyMap<string, Process.Running>
  readonly pendingTuis: ReadonlyMap<string, Process.Running>
}

type State = Data.TaggedEnum<{
  readonly Running: StateFields
  readonly Stopping: StateFields
  readonly Stopped: StateFields
}>

const State = Data.taggedEnum<State>()

export const make = Effect.fn("OpenCodeInstance.make")(function* (
  options: Options,
  configuredTools?: ToolController.Controller,
) {
  const artifacts = resolve(options.artifacts)
  const logs = join(artifacts, "logs")
  const drive = join(artifacts, "drive")
  const files = join(artifacts, "files")
  let mediaGeneration = 0
  let media = runMediaDirectory(artifacts, mediaGeneration)
  const uiPort = yield* freePort
  const endpoints = {
    ui: `ws://127.0.0.1:${uiPort}`,
    backend: `ws://127.0.0.1:${yield* distinctPort(uiPort)}`,
  }
  const toolController = configuredTools ?? (yield* ToolController.make(options.tools))
  const database = yield* Config.string("OPENCODE_DRIVE_DB").pipe(Config.withDefault(":memory:"))
  const setup =
    configuredTools === undefined ? ToolController.composeSetup(toolController, options.setup) : options.setup
  if (options.project !== undefined || options.config !== undefined || options.tui !== undefined || setup !== undefined)
    yield* prepareInstanceProject({
      artifacts,
      project: options.project,
      config: options.config,
      tui: options.tui,
      setup,
    }).pipe(Effect.mapError((cause) => instanceError("prepare project", cause)))
  const dev = options.dev !== undefined ? yield* prepareDev(artifacts, options.dev) : undefined
  const environment = stripGitEnvironment({
    ...process.env,
    ...options.env,
    BUN_OPTIONS:
      dev === undefined
        ? (options.env?.BUN_OPTIONS ?? process.env.BUN_OPTIONS)
        : [options.env?.BUN_OPTIONS ?? process.env.BUN_OPTIONS, ...dev.preloads].filter(Boolean).join(" "),
    OPENCODE_SIMULATE: "1",
    OPENCODE_DRIVE_SCRIPTED: options.scripted ? "1" : undefined,
    DRIVE_REGISTRY_DIR: drive,
    OPENCODE_DRIVE_RENDERER: options.visible ? "visible" : "headless",
    OPENCODE_DRIVE_DEV: options.dev,
    OPENCODE_CONFIG_DIR: join(files, ".opencode"),
    OPENCODE_DB: database,
    OPENCODE_LOG_LEVEL: !options.visible ? "DEBUG" : process.env.OPENCODE_LOG_LEVEL,
    OPENCODE_TEST_HOME: artifacts,
    XDG_CACHE_HOME: join(artifacts, "home", ".cache"),
    XDG_CONFIG_HOME: join(artifacts, "home", ".config"),
    XDG_DATA_HOME: logs,
    XDG_STATE_HOME: join(artifacts, "home", ".local", "state"),
  })
  const command = dev !== undefined ? dev.command : options.command?.length ? [...options.command] : ["opencode2"]
  const scriptedCommand = dev?.scriptedCommand ?? command
  const initialRecording = options.record ? recordingPaths(media) : undefined
  const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const fileSystem = yield* FileSystem.FileSystem
  const state = yield* Ref.make<State>(
    State.Running({
      recording: initialRecording,
      tuis: new Map(),
      pendingTuis: new Map(),
    }),
  )
  const lock = yield* Semaphore.make(1)
  const instanceScope = yield* Scope.Scope

  const writeManifest = Effect.fn("OpenCodeInstance.writeManifest")(function* (
    name: string,
    manifestEndpoints: { readonly ui: string; readonly backend: string },
    recording?: RecordingPaths,
    viewport?: Viewport,
  ) {
    yield* Effect.tryPromise({
      try: () =>
        Bun.write(
          join(drive, `${name}.json`),
          `${JSON.stringify(
            {
              endpoints: manifestEndpoints,
              ...(viewport ? { viewport } : {}),
              ...(recording ? { recording: { timeline: recording.timeline } } : {}),
            },
            undefined,
            2,
          )}\n`,
        ),
      catch: (cause) => instanceError("write manifest", cause),
    })
  })

  const spawn = Effect.fn("OpenCodeInstance.spawn")(function* (
    driveName: string,
    appCommand: ReadonlyArray<string>,
    logName: string,
    visible: boolean,
  ) {
    options.log?.(`launching ${logName}`)
    return yield* Process.spawn(appCommand, {
      cwd: files,
      env: {
        ...environment,
        OPENCODE_DRIVE: driveName,
        OPENCODE_DRIVE_MEDIA_DIR: media,
      },
      stdin: visible ? "inherit" : "ignore",
      stdout: visible ? "inherit" : { path: join(logs, `${logName}.stdout.log`) },
      stderr: visible ? "inherit" : { path: join(logs, `${logName}.stderr.log`) },
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, processSpawner),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Scope.provide(instanceScope),
      Effect.mapError((cause) => instanceError(`launch ${logName}`, cause)),
    )
  })

  const launchDefault = Effect.fn("OpenCodeInstance.launchDefault")(function* (recording: RecordingPaths | undefined) {
    yield* writeManifest(options.name, endpoints, recording, options.viewport)
    options.log?.("launching OpenCode")
    return yield* spawn(options.name, command, "opencode", options.visible ?? false)
  })

  if (!options.scripted) {
    const primary = yield* launchDefault(initialRecording)
    yield* Ref.update(state, (current) => ({ ...current, primary }))
  }

  const launchServer = Effect.gen(function* () {
    const server = yield* lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (!options.scripted)
          return yield* Effect.fail(instanceError("launch server", "server launch requires scripted mode"))
        if (current._tag !== "Running")
          return yield* Effect.fail(instanceError("launch server", "the instance is stopping"))
        if (current.server !== undefined || current.pendingServer !== undefined)
          return yield* Effect.fail(instanceError("launch server", "the script server has already been launched"))
        const name = processDriveName(options.name, "service")
        const serverCommand = [...scriptedCommand, "serve", "--service", "--port", String(yield* freePort)]
        yield* writeManifest(name, {
          ui: `ws://127.0.0.1:${yield* freePort}`,
          backend: endpoints.backend,
        })
        options.log?.("launching script server")
        const server = yield* spawn(name, serverCommand, "service", false)
        yield* Ref.update(state, (value) => ({ ...value, pendingServer: server }))
        return server
      }),
    )
    const removePending = lock.withPermit(
      Ref.update(state, (value) => (value.pendingServer === server ? { ...value, pendingServer: undefined } : value)),
    )
    yield* waitForWebSocket(endpoints.backend, server, 60_000).pipe(
      Effect.onError(() => removePending.pipe(Effect.andThen(server.terminate), Effect.ignore)),
      Effect.mapError((cause) => instanceError("wait for server", cause)),
    )
    const committed = yield* lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current._tag !== "Running" || current.pendingServer !== server) return false
        yield* Ref.set(state, {
          ...current,
          pendingServer: undefined,
          server,
          primary: server,
        })
        return true
      }),
    )
    if (!committed) {
      yield* server.terminate.pipe(Effect.ignore)
      return yield* Effect.fail(instanceError("launch server", "the instance is stopping"))
    }
    yield* server.exitCode.pipe(
      Effect.ignore,
      Effect.andThen(Ref.update(state, (value) => (value.server === server ? { ...value, server: undefined } : value))),
      Effect.forkIn(instanceScope),
    )
    options.log?.("script server ready")
    return { endpoint: endpoints.backend }
  })

  const killServer = lock.withPermit(
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (!options.scripted)
        return yield* Effect.fail(instanceError("kill server", "server kill requires scripted mode"))
      if (current.server === undefined)
        return yield* Effect.fail(instanceError("kill server", "the script server is not running"))
      options.log?.("stopping script server")
      yield* current.server.terminate.pipe(Effect.mapError((cause) => instanceError("kill server", cause)))
      yield* Ref.update(state, (value) => ({
        ...value,
        server: undefined,
        primary: value.primary === current.server ? undefined : value.primary,
      }))
      return undefined
    }),
  )

  const launchTui = Effect.fn("OpenCodeInstance.launchTui")(function* (
    name: string,
    tuiOptions: { readonly record?: boolean; readonly viewport?: Viewport } = {},
  ) {
    const pending = yield* lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (!options.scripted)
          return yield* Effect.fail(instanceError("launch TUI", "TUI launch requires scripted mode"))
        if (current._tag !== "Running")
          return yield* Effect.fail(instanceError("launch TUI", "the instance is stopping"))
        if (current.server === undefined)
          return yield* Effect.fail(instanceError("launch TUI", "launch the script server before launching TUIs"))
        if (!isValidName(name)) return yield* Effect.fail(instanceError("launch TUI", `invalid TUI name: ${name}`))
        if (current.tuis.has(name) || current.pendingTuis.has(name))
          return yield* Effect.fail(instanceError("launch TUI", `TUI "${name}" is already running`))
        if (options.visible && current.tuis.size + current.pendingTuis.size > 0)
          return yield* Effect.fail(instanceError("launch TUI", "multiple TUIs require headless scripted mode"))
        const primary = current.tuis.size + current.pendingTuis.size === 0
        const tuiEndpoints = {
          ui: primary ? endpoints.ui : `ws://127.0.0.1:${yield* freePort}`,
          backend: endpoints.backend,
        }
        const driveName = processDriveName(options.name, `tui-${name}`)
        const recording = tuiOptions.record ? recordingPaths(media) : primary ? current.recording : undefined
        yield* writeManifest(driveName, tuiEndpoints, recording, tuiOptions.viewport ?? options.viewport)
        options.log?.(`launching TUI ${name}`)
        const tui = yield* spawn(driveName, scriptedCommand, `tui-${name}`, options.visible ?? false)
        yield* Ref.update(state, (value) => ({
          ...value,
          pendingTuis: new Map(value.pendingTuis).set(name, tui),
        }))
        return { tui, tuiEndpoints, primary, recording }
      }),
    )
    const { tui, tuiEndpoints, primary, recording } = pending
    const removePending = lock.withPermit(
      Ref.update(state, (value) => {
        if (value.pendingTuis.get(name) !== tui) return value
        const pendingTuis = new Map(value.pendingTuis)
        pendingTuis.delete(name)
        return { ...value, pendingTuis }
      }),
    )
    yield* waitForWebSocket(tuiEndpoints.ui, tui, 60_000).pipe(
      Effect.onError(() => removePending.pipe(Effect.andThen(tui.terminate), Effect.ignore)),
      Effect.mapError((cause) => instanceError("wait for TUI", cause)),
    )
    const committed = yield* lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current._tag !== "Running" || current.pendingTuis.get(name) !== tui) return false
        const pendingTuis = new Map(current.pendingTuis)
        pendingTuis.delete(name)
        yield* Ref.set(state, {
          ...current,
          primary: primary ? tui : current.primary,
          tuis: new Map(current.tuis).set(name, tui),
          pendingTuis,
        })
        return true
      }),
    )
    if (!committed) {
      yield* tui.terminate.pipe(Effect.ignore)
      return yield* Effect.fail(instanceError("launch TUI", "the instance is stopping"))
    }
    yield* tui.exitCode.pipe(
      Effect.ignore,
      Effect.andThen(
        Ref.update(state, (value) => {
          if (value.tuis.get(name) !== tui) return value
          const tuis = new Map(value.tuis)
          tuis.delete(name)
          return { ...value, tuis }
        }),
      ),
      Effect.forkIn(instanceScope),
    )
    options.log?.(`TUI ${name} ready`)
    const close = Effect.gen(function* () {
      yield* Ref.update(state, (value) => {
        if (value.tuis.get(name) !== tui) return value
        const tuis = new Map(value.tuis)
        tuis.delete(name)
        return { ...value, tuis }
      })
      yield* tui.terminate.pipe(Effect.mapError((cause) => instanceError("close TUI", cause)))
    })
    return {
      endpoint: tuiEndpoints.ui,
      process: tui,
      recording,
      close,
    } satisfies TuiProcess
  })

  const waitForDrive = Effect.fn("OpenCodeInstance.waitForDrive")(function* (
    requirement: "ui" | "backend" | "both" = "both",
    timeout = 60_000,
  ) {
    const current = yield* Ref.get(state)
    const process = current.primary
    if (process === undefined)
      return yield* Effect.fail(instanceError("wait for drive", "no OpenCode process has been launched"))
    const urls = requirement === "both" ? [endpoints.ui, endpoints.backend] : [endpoints[requirement]]
    yield* Effect.forEach(urls, (url) => waitForWebSocket(url, process, timeout), {
      concurrency: "unbounded",
      discard: true,
    }).pipe(Effect.mapError((cause) => instanceError("wait for drive", cause)))
    return undefined
  })

  const restart = lock.withPermit(
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current._tag !== "Running") return yield* Effect.fail(instanceError("restart", "the instance is stopping"))
      options.log?.("restarting OpenCode")
      const processes = new Set([...current.tuis.values(), ...current.pendingTuis.values()])
      if (current.server !== undefined) processes.add(current.server)
      if (current.pendingServer !== undefined) processes.add(current.pendingServer)
      if (!options.scripted && current.primary !== undefined) processes.add(current.primary)
      const exits = yield* Effect.forEach(processes, (process) => Effect.exit(process.terminate), {
        concurrency: "unbounded",
      })
      const combined = Exit.asVoidAll(exits)
      if (Exit.isFailure(combined))
        return yield* Effect.failCause(combined.cause).pipe(Effect.mapError((cause) => instanceError("restart", cause)))
      media = runMediaDirectory(artifacts, ++mediaGeneration)
      const recording = options.record ? recordingPaths(media) : undefined
      yield* Ref.set(
        state,
        State.Running({
          recording,
          tuis: new Map(),
          pendingTuis: new Map(),
        }),
      )
      if (!options.scripted) {
        const primary = yield* launchDefault(recording)
        yield* Ref.update(state, (value) => ({ ...value, primary }))
        yield* waitForDrive("both")
        options.log?.("OpenCode ready")
      }
      return undefined
    }),
  )

  const wait: Effect.Effect<number, OpenCodeInstanceError> = Effect.suspend(() =>
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current.primary === undefined)
        return yield* Effect.fail(instanceError("wait", "no OpenCode process has been launched"))
      const active = current.primary
      const status = yield* active.exitCode.pipe(Effect.mapError((cause) => instanceError("wait", cause)))
      const next = yield* Ref.get(state)
      if (next.primary !== active && next._tag === "Running") return yield* wait
      return status
    }),
  )

  const stop = lock.withPermit(
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current._tag === "Stopped") return undefined
      yield* Ref.set(state, State.Stopping(current))
      options.log?.("stopping OpenCode")
      const processes = new Set(current.tuis.values())
      for (const process of current.pendingTuis.values()) processes.add(process)
      if (current.server !== undefined) processes.add(current.server)
      if (current.pendingServer !== undefined) processes.add(current.pendingServer)
      if (!options.scripted && current.primary !== undefined) processes.add(current.primary)
      const exits = yield* Effect.forEach(processes, (process) => Effect.exit(process.terminate), {
        concurrency: "unbounded",
      })
      const serviceExit = yield* Effect.exit(stopService(join(artifacts, "home", ".local", "state")))
      yield* Ref.set(
        state,
        State.Stopped({
          recording: current.recording,
          tuis: new Map(),
          pendingTuis: new Map(),
        }),
      )
      const combined = Exit.asVoidAll([...exits, serviceExit])
      if (Exit.isFailure(combined))
        return yield* Effect.failCause(combined.cause).pipe(Effect.mapError((cause) => instanceError("stop", cause)))
      return undefined
    }),
  )
  yield* Effect.addFinalizer(() =>
    stop.pipe(Effect.catchCause((cause) => Effect.logError("OpenCode instance cleanup failed", cause))),
  )

  return {
    artifacts,
    logs,
    visible: options.visible ?? false,
    endpoints,
    tools: toolController.controls,
    toolNames: toolController.names,
    recording: Ref.get(state).pipe(Effect.map((current) => current.recording)),
    primary: Ref.get(state).pipe(
      Effect.flatMap((current) =>
        current.primary === undefined
          ? Effect.fail(instanceError("primary", "no OpenCode process has been launched"))
          : Effect.succeed(current.primary),
      ),
    ),
    launchServer,
    killServer,
    launchTui,
    waitForDrive,
    restart,
    wait,
    stop,
  } satisfies Instance
})

function processDriveName(instance: string, role: string) {
  const suffix = crypto.randomUUID().slice(0, 8)
  return `${instance.slice(0, 36)}-${role.slice(0, 17)}-${suffix}`
}

function recordingPaths(directory: string): RecordingPaths {
  const id = crypto.randomUUID()
  return {
    timeline: join(directory, `recording-${id}.jsonl`),
    video: join(directory, `recording-${id}.mp4`),
  }
}

export * as OpenCodeInstance from "./runtime.js"

const distinctPort = (excluded: number): Effect.Effect<number, OpenCodeInstanceError> =>
  freePort.pipe(Effect.flatMap((port) => (port === excluded ? distinctPort(excluded) : Effect.succeed(port))))

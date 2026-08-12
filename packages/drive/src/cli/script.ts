import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as OpenCodeDriver from "../driver/index.js"
import type * as OpenCodeTui from "../driver/client.js"
import * as OpenCodeUi from "../driver/ui.js"
import * as PreparedDriver from "../driver/prepared.js"
import type * as OpenCodeInstance from "../instance/runtime.js"
import { createScriptFileSystem } from "../script/filesystem.js"
import { hasGitMetadata } from "../script/project.js"
import { Names as ToolNames } from "../tool/types.js"
import type {
  AutomaticScriptDefinition,
  ScriptDefinition,
} from "../script/types.js"

export const loadScript = Effect.fn("DriveCli.loadScript")((file: string) =>
  Effect.tryPromise({
    try: async () => {
      const module: unknown = await import(pathToFileURL(resolve(file)).href)
      return isRecord(module) ? { default: module.default } : {}
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((module) =>
      isScriptDefinition(module.default)
        ? Effect.succeed(module.default)
        : Effect.fail(new Error("script must default-export defineScript(...)")),
    ),
  ),
)

export const runScript = Effect.fn("DriveCli.runScript")(function* (
  script: ScriptDefinition,
  instance: OpenCodeInstance.Instance,
  onScreenshot?: (path: string) => void,
  onRecording?: (path: string) => void,
  onReady?: () => void,
) {
  const prepared = yield* PreparedDriver.make(instance, {
    visible: instance.visible,
    launch: "launch" in script ? "manual" : "automatic",
    tuiName: "default",
    tui: script.tui,
  })
  const protectGit = yield* Effect.promise(() =>
    hasGitMetadata(join(instance.artifacts, "files")),
  )
  const operationFailure = yield* Deferred.make<never, unknown>()
  const runUi = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.tapError((cause) =>
        cause instanceof OpenCodeDriver.UiTimeoutError
          ? Deferred.fail(operationFailure, cause).pipe(Effect.asVoid)
          : Effect.void,
      ),
    )
  const recordings = new Set<string>()
  const reportRecording = (path: string) => {
    if (recordings.has(path)) return
    recordings.add(path)
    onRecording?.(path)
  }
  const adaptUi = (ui: OpenCodeUi.Ui): OpenCodeUi.Ui => {
    const transformed = OpenCodeUi.transform(ui, runUi)
    return {
      ...transformed,
      screenshot: (name) =>
        transformed.screenshot(name).pipe(
          Effect.tap((path) =>
            Effect.sync(() => onScreenshot?.(path)),
          ),
        ),
    }
  }
  const adaptTui = (tui: OpenCodeTui.Tui): OpenCodeTui.Tui => {
    const recording = tui.recording
    return {
      ui: adaptUi(tui.ui),
      close: tui.close,
      ...(recording === undefined
        ? {}
        : {
            recording: {
              path: recording.path,
              timeline: recording.timeline,
              finish: () =>
                runUi(recording.finish()).pipe(
                  Effect.tap((path) =>
                    Effect.sync(() => reportRecording(path)),
                  ),
                ),
            },
          }),
    }
  }
  const tuiOptions = (options?: OpenCodeTui.TuiOptions) => ({
    ...("launch" in script ? script.tui : undefined),
    ...options,
  })
  function launchTui(
    options?: OpenCodeTui.TuiOptions,
  ): ReturnType<OpenCodeTui.Tuis["launch"]>
  function launchTui(
    name: string,
    options?: OpenCodeTui.TuiOptions,
  ): ReturnType<OpenCodeTui.Tuis["launch"]>
  function launchTui(
    nameOrOptions?: string | OpenCodeTui.TuiOptions,
    options?: OpenCodeTui.TuiOptions,
  ) {
    const launched = typeof nameOrOptions === "string"
      ? prepared.tuis.launch(nameOrOptions, tuiOptions(options))
      : prepared.tuis.launch(tuiOptions(nameOrOptions))
    return launched.pipe(
      Effect.tap(() => Effect.sync(() => onReady?.())),
      Effect.map(adaptTui),
    )
  }
  const tuis: OpenCodeTui.Tuis = { launch: launchTui }
  const context = {
    fs: createScriptFileSystem(join(instance.artifacts, "files"), {
      git: protectGit,
    }),
    tuis,
    server: {
      launch: prepared.server.launch,
      kill: prepared.server.kill,
    },
    llm: prepared.llm,
    tools: prepared.tools,
    artifacts: instance.artifacts,
  }
  const primaryTui = prepared.primary
  const automatic = (definition: AutomaticScriptDefinition) => {
    if (primaryTui === undefined || prepared.driver === undefined)
      return Effect.fail(
        new Error("automatic script did not launch its primary TUI"),
      )
    const tui = adaptTui(primaryTui)
    return definition.run({
      ...context,
      opencode: prepared.driver.opencode,
      tui,
      ui: tui.ui,
    })
  }
  const execution =
    "launch" in script
      ? script.run({ ...context, tui: null, ui: null })
      : automatic(script)
  if (!Effect.isEffect(execution))
    return yield* Effect.fail(new Error("script run must return an Effect"))
  if (primaryTui !== undefined) onReady?.()
  yield* Effect.raceAllFirst([
    execution,
    Deferred.await(operationFailure),
    prepared.failure.pipe(
      Effect.catchIf(isZeroStatusTuiExit, () => Effect.void),
    ),
  ])
  const report = yield* prepared.settle()
  for (const path of report.recordings) reportRecording(path)
  return undefined
})

function isZeroStatusTuiExit(cause: unknown) {
  return (
    cause instanceof OpenCodeDriver.OpenCodeDriverError &&
    cause.operation === "tui.exit" &&
    cause.message.endsWith("status 0")
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isScriptDefinition(value: unknown): value is ScriptDefinition {
  if (!isRecord(value)) return false
  return (
    value.kind === "opencode-drive/script" &&
    typeof value.run === "function" &&
    (value.project === undefined || isScriptProject(value.project)) &&
    (value.config === undefined || isJsonObject(value.config)) &&
    (value.tuiConfig === undefined || isJsonObject(value.tuiConfig)) &&
    (value.setup === undefined || typeof value.setup === "function") &&
    (value.tools === undefined || isToolConfiguration(value.tools)) &&
    (value.tui === undefined || isTuiOptions(value.tui)) &&
    (!("launch" in value) || value.launch === "manual")
  )
}

function isToolConfiguration(value: unknown) {
  return typeof value === "function" || Schema.is(ToolNames)(value)
}

function isTuiOptions(value: unknown) {
  if (!isRecord(value)) return false
  if (value.recording !== undefined && typeof value.recording !== "boolean")
    return false
  if (value.viewport === undefined) return true
  if (!isRecord(value.viewport)) return false
  return (
    typeof value.viewport.cols === "number" &&
    Number.isFinite(value.viewport.cols) &&
    typeof value.viewport.rows === "number" &&
    Number.isFinite(value.viewport.rows)
  )
}

function isJsonObject(value: unknown) {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isScriptProject(value: unknown) {
  if (!isRecord(value)) return false
  if (value.git !== undefined && typeof value.git !== "boolean") return false
  if (value.files === undefined) return true
  if (!isRecord(value.files)) return false
  const prototype = Object.getPrototypeOf(value.files)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(value.files).every(
    (contents) => typeof contents === "string" || contents instanceof Uint8Array,
  )
}

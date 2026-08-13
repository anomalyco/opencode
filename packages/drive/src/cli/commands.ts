import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { Frontend } from "../client/protocol.js"
import { recordLog } from "../log.js"
import * as SimulationConnector from "../simulation/connector.js"
import type { DriveCommand } from "./types.js"

export const commandInfo = {
  "ui.type": { value: true, description: "Type text using JSON params" },
  "ui.press": { value: true, description: "Press a key using JSON params" },
  "ui.enter": { value: false, description: "Press Enter" },
  "ui.arrow": {
    value: true,
    description: "Press an arrow key using JSON params",
  },
  "ui.focus": {
    value: true,
    description: "Focus an element using JSON params",
  },
  "ui.click": { value: true, description: "Click using JSON params" },
  "ui.resize": {
    value: true,
    description: "Resize terminal viewport using JSON params",
  },
  "ui.screenshot": {
    value: "optional",
    description: "Take a screenshot with optional JSON params and return its path",
  },
  "ui.capture": {
    value: false,
    description: "Capture the terminal frame as JSON",
  },
  "ui.state": {
    value: false,
    description: "Return focus, elements, and available UI actions",
  },
  "ui.snapshot": {
    value: false,
    description: "Return the semantic UI tree as JSON",
  },
  "ui.matches": {
    value: true,
    description: "Check for literal screen text using JSON params",
  },
  "ui.recording.finish": {
    value: false,
    description: "Finish recording and return the timeline path",
  },
} as const satisfies Record<
  Exclude<Frontend.Capability, "ui.click.semantic">,
  { readonly value: boolean | "optional"; readonly description: string }
>

type CommandName = Exclude<Frontend.Capability, "ui.click.semantic">

export function isCommandName(operation: string): operation is CommandName {
  return Object.hasOwn(commandInfo, operation)
}

export function commandAcceptsValue(operation: CommandName) {
  return commandInfo[operation].value
}

export function commandNames() {
  return Object.keys(commandInfo).sort()
}

export class SimulationError extends Error {
  constructor(
    message: string,
    readonly method?: string,
  ) {
    super(message)
    this.name = "SimulationError"
  }
}

export class CommandBatchError extends Error {
  constructor(
    readonly results: ReadonlyArray<{
      readonly command: string
      readonly result: unknown
    }>,
    readonly reason: unknown,
  ) {
    super(reason instanceof Error ? reason.message : String(reason))
    this.name = "CommandBatchError"
  }
}

const callTimeout = 30_000

export async function executeCommands(endpoint: string, commands: ReadonlyArray<DriveCommand>) {
  const exit = await Effect.runPromiseExit(Effect.scoped(executeBatch(endpoint, commands)))
  if (Exit.isSuccess(exit)) return exit.value
  const reason = Cause.squash(exit.cause)
  throw reason instanceof CommandBatchError ? reason : new CommandBatchError([], reason)
}

const executeBatch = Effect.fn("DriveCli.executeBatch")(function* (
  endpoint: string,
  commands: ReadonlyArray<DriveCommand>,
) {
  const connection = yield* SimulationConnector.ui(endpoint, {
    connectTimeout: callTimeout,
  }).pipe(
    Effect.mapError(
      (cause) => new SimulationError(cause instanceof Error ? cause.message : `cannot connect to ${endpoint}`),
    ),
  )
  const results: Array<{ readonly command: string; readonly result: unknown }> = []
  for (const command of commands) {
    const result = yield* execute(connection, command).pipe(
      Effect.mapError((error) => new CommandBatchError(results, error)),
    )
    results.push({ command: command.operation, result })
  }
  return { results }
})

const execute = (
  connection: SimulationConnector.UiConnection,
  command: DriveCommand,
): Effect.Effect<unknown, SimulationError> =>
  Effect.suspend(() => {
    recordLog("INFO", `ui command ${command.operation} params=${command.value ?? "undefined"}`)
    return dispatch(connection, decodeCommand(command))
  }).pipe(
    Effect.timeoutOrElse({
      duration: callTimeout,
      orElse: () => Effect.fail(new SimulationError(`timed out after ${callTimeout}ms`, command.operation)),
    }),
    Effect.mapError((cause) =>
      cause instanceof SimulationError
        ? cause
        : new SimulationError(cause instanceof Error ? cause.message : String(cause), command.operation),
    ),
    Effect.tap(() => Effect.sync(() => recordLog("INFO", `ui command ${command.operation} completed`))),
    Effect.tapError((error) =>
      Effect.sync(() => recordLog("ERROR", `ui command ${command.operation} failed: ${error.message}`)),
    ),
  )

function decodeCommand(command: DriveCommand): Frontend.Request {
  if (command.value === undefined && commandInfo[command.operation].value === true)
    throw new Error(`${command.operation} requires a value`)
  return Frontend.decodeRequest(
    {
      jsonrpc: "2.0",
      method: command.operation,
      ...(command.value === undefined ? {} : { params: JSON.parse(command.value) }),
    },
    { onExcessProperty: "error" },
  )
}

function dispatch(
  connection: SimulationConnector.UiConnection,
  request: Frontend.Request,
): Effect.Effect<unknown, unknown> {
  if (
    request.method === "ui.snapshot" &&
    !SimulationConnector.supportsCapability(connection.compatibility, "ui.snapshot")
  )
    return Effect.fail(new SimulationError("ui.snapshot is not available on this OpenCode endpoint", request.method))
  if (
    request.method === "ui.click" &&
    request.params.semantic !== undefined &&
    !SimulationConnector.supportsCapability(connection.compatibility, "ui.click.semantic")
  )
    return Effect.fail(
      new SimulationError("semantic ui.click is not available on this OpenCode endpoint", request.method),
    )
  switch (request.method) {
    case "ui.type":
      return connection.rpc["ui.type"](request.params)
    case "ui.press":
      return connection.rpc["ui.press"](request.params)
    case "ui.enter":
      return connection.rpc["ui.enter"]()
    case "ui.arrow":
      return connection.rpc["ui.arrow"](request.params)
    case "ui.focus":
      return connection.rpc["ui.focus"](request.params)
    case "ui.click":
      return connection.rpc["ui.click"](request.params)
    case "ui.resize":
      return connection.rpc["ui.resize"](request.params)
    case "ui.screenshot":
      return connection.rpc["ui.screenshot"](request.params)
    case "ui.capture":
      return connection.rpc["ui.capture"]()
    case "ui.state":
      return connection.rpc["ui.state"]()
    case "ui.snapshot":
      return connection.rpc["ui.snapshot"]()
    case "ui.matches":
      return connection.rpc["ui.matches"](request.params)
    case "ui.recording.finish":
      return connection.rpc["ui.recording.finish"]()
  }
  throw new Error(`unsupported UI method ${request.method}`)
}

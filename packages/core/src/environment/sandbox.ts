import { ChildProcess } from "effect/process"
import { make } from "effect/process/ChildProcessSpawner"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { Driver } from "./driver.js"
import { makeLocalDriver } from "./local.js"

/**
 * Best-effort credential scrubbing for the opt-in sandbox. This is a
 * process-environment boundary, not an OS security boundary: a command can
 * still read files the host user can read. Names are matched broadly because
 * providers keep introducing new credential variable names.
 */
const SENSITIVE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH|PRIVATE)/i

type Env = NonNullable<ChildProcess.CommandOptions["env"]>

export const sanitizeEnv = (env: Env): Env =>
  Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !SENSITIVE_ENV.test(key)))

/** Rebuild a command with a scrubbed environment and a fixed working directory, including every stage of a pipe. */
export const sandboxCommand = (command: ChildProcess.Command, cwd: string): ChildProcess.Command => {
  switch (command._tag) {
    case "StandardCommand":
      return ChildProcess.make(command.command, command.args, {
        ...command.options,
        cwd,
        env: sanitizeEnv(command.options.env ?? process.env),
        extendEnv: false,
      })
    case "PipedCommand":
      return ChildProcess.pipeTo(sandboxCommand(command.left, cwd), sandboxCommand(command.right, cwd), command.options)
  }
}

/** Local execution with tool processes detached from host credentials and pinned to the project directory. */
export const makeSandboxDriver = (spawner: ChildProcessSpawner["Service"], directory: string): Driver =>
  makeLocalDriver(make((command) => spawner.spawn(sandboxCommand(command, directory))))

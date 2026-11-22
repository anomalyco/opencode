export * as SessionShell from "./shell.js"

import type { Session } from "@opencode/schema/session"
import { Effect, Option } from "effect"
import { Environment } from "../environment/index.js"
import { Flag } from "../flag.js"
import { Instance } from "../instance/service.js"
import { Machines } from "../machine/machines.js"
import { Plugin } from "../plugin/service.js"
import { Shell } from "../shell.js"
import { ShellResult } from "../shell/result.js"
import { SessionCwd } from "./cwd.js"

export const start = Effect.fn("SessionShell.start")(function* (input: { session: Session.Info; command: string }) {
  const instances = yield* Instance.Service
  const { cwd, shell } = yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    // A session's own cwd, when it has one, is where its user shell commands run.
    // A fixture may hold none of these; a cwd that cannot be placed then stays the Location's directory.
    const cwd = SessionCwd.current({
      session: input.session,
      flag: Option.getOrUndefined(yield* Effect.serviceOption(Flag.Service)),
      environment: Option.getOrUndefined(yield* Effect.serviceOption(Environment.Service)),
      machines: Option.getOrUndefined(yield* Effect.serviceOption(Machines.Service)),
    })
    return { cwd: yield* cwd, shell: yield* Shell.Service }
  }).pipe(instances.provide(input.session))
  const info = yield* shell.create({
    command: input.command,
    cwd: cwd?.absolute ?? input.session.location.directory,
    ...(cwd ? { environment: cwd.environment } : {}),
    timeout: 0,
    metadata: { sessionID: input.session.id, background: true },
  })
  // Keep completion tied to the original shell even if the Session moves.
  return {
    info,
    result: shell.result(info),
    output: shell
      .output(info.id, { limit: 1024 * 1024 })
      .pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(ShellResult.unavailable))),
  }
})

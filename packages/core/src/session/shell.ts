export * as SessionShell from "./shell.js"

import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { Shell } from "../shell.js"
import { ShellResult } from "../shell/result.js"
import { SessionCwd } from "./cwd.js"

export const start = Effect.fn("SessionShell.start")(function* (input: { session: Session.Info; command: string }) {
  const instances = yield* Instance.Service
  const context = yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    return {
      cwd: yield* SessionCwd.current(input.session.id),
      shell: yield* Shell.Service,
    }
  }).pipe(instances.provide(input.session))
  const info = yield* context.shell.create({
    command: input.command,
    cwd: context.cwd?.absolute ?? input.session.location.directory,
    environment: context.cwd?.environment,
    timeout: 0,
    metadata: { sessionID: input.session.id, background: true },
  })
  // Keep completion tied to the original shell even if the Session moves.
  return {
    info,
    result: context.shell.result(info),
    output: context.shell
      .output(info.id, { limit: 1024 * 1024 })
      .pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(ShellResult.unavailable))),
  }
})

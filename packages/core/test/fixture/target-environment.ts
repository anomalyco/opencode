import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { posix } from "node:path"
import { permissionLayer } from "../lib/permission"
import { hostEnvironmentLayer } from "./environment"
import { location } from "./location"

/** What a paired machine's environment says about itself. */
export const machineFacts = { path: posix, shell: "sh" }

/**
 * A session on the host at `directory` whose resolved targets all live in another environment, in memory
 * unless one is given. A tool that still acts through the session's environment touches the host instead.
 * An environment given here needs an id other than the session's, or it names the same machine.
 */
export const elsewhere = (
  directory: string,
  environment = Environment.make(Environment.ID.make("elsewhere"), Environment.makeMemoryDriver(), machineFacts),
) => {
  const assertions: Permission.AssertInput[] = []
  const checked: Permission.AssertInput[] = []
  const replacements = [
    Environment.node.replace(hostEnvironmentLayer),
    Permission.node.replace(
      permissionLayer({
        assert: (input) => Effect.sync(() => void assertions.push(input)),
        assertNotDenied: (input) => Effect.sync(() => void checked.push(input)),
      }),
    ),
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
  ]
  // Resolves and authorizes exactly as the session does, then places each target in the other environment, on that
  // machine as a resolved machine path is.
  const placed = (target: FileAccess.Target) =>
    environment.id === Environment.localID
      ? { ...target, environment }
      : { ...target, environment, machine: environment.id }
  const access = Layer.effect(
    FileAccess.Service,
    Effect.gen(function* () {
      const session = yield* FileAccess.Service
      return FileAccess.Service.of({
        ...session,
        resolve: (input) => session.resolve(input).pipe(Effect.map(placed)),
        authorizeRead: (input, context, options) =>
          session.authorizeRead(input, context, options).pipe(Effect.map(placed)),
      })
    }),
  ).pipe(Layer.provide(LayerNode.compile(FileAccess.node, { replacements })))
  return { environment, assertions, checked, replacements: [...replacements, FileAccess.node.replace(access)] }
}

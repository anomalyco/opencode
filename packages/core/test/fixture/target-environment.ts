import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { permissionLayer } from "../lib/permission"
import { hostEnvironmentLayer } from "./environment"
import { location } from "./location"

const memoryEnvironment = (): Environment.Interface => {
  const driver = Environment.makeMemoryDriver()
  return { files: Environment.makeFiles(driver), spawner: driver.spawner }
}

/**
 * A session on the host at `directory` whose resolved targets all live in another environment, in memory
 * unless one is given. A tool that still acts through the session's environment touches the host instead.
 */
export const elsewhere = (directory: string, environment = memoryEnvironment()) => {
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
  // Resolves and authorizes exactly as the session does, then places each target in the other environment.
  const access = Layer.effect(
    FileAccess.Service,
    Effect.gen(function* () {
      const session = yield* FileAccess.Service
      return FileAccess.Service.of({
        ...session,
        resolve: (input) => session.resolve(input).pipe(Effect.map((target) => ({ ...target, environment }))),
        authorizeRead: (input, context, options) =>
          session.authorizeRead(input, context, options).pipe(Effect.map((target) => ({ ...target, environment }))),
      })
    }),
  ).pipe(Layer.provide(LayerNode.compile(FileAccess.node, { replacements })))
  return { environment, assertions, checked, replacements: [...replacements, FileAccess.node.replace(access)] }
}

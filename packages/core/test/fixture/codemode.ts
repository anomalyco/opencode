import { CodeModeTool } from "@opencode/core/codemode/tool"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { permissionLayer } from "../lib/permission"
import { hostEnvironmentLayer } from "./environment"
import { location } from "./location"

/** What a session at `directory` gives Code Mode with `full_codemode`: its Location and file services on the host. */
export const codeModeServices = (
  directory: string,
  permission: Partial<Permission.Interface> = { assert: () => Effect.void },
  formatter: Formatter.Interface["file"] = () => Effect.succeed(false),
) =>
  Effect.runSync(
    CodeModeTool.services.pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([Environment.node, FileAccess.node, FileMutation.node, FileWrite.node, Location.node]),
          [
            Environment.node.replace(hostEnvironmentLayer),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ),
            Formatter.node.replace(Layer.mock(Formatter.Service, { file: formatter })),
            Permission.node.replace(permissionLayer(permission)),
          ],
        ),
      ),
    ),
  )

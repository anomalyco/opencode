import { Catalog } from "@opencode-ai/core/catalog"
import { Instance } from "@opencode-ai/core/instance"
import { InstanceServiceMap } from "@opencode-ai/core/instance-layer"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

export class V2InstanceMiddleware extends HttpApiMiddleware.Service<
  V2InstanceMiddleware,
  {
    provides: Catalog.Service | PluginBoot.Service
  }
>()("@opencode/ExperimentalHttpApiV2Instance") {}

function header(request: HttpServerRequest.HttpServerRequest, names: string[]) {
  return names.map((name) => request.headers[name]).find((value) => value && value.length > 0)
}

function ref(request: HttpServerRequest.HttpServerRequest): Instance.Ref {
  return {
    directory: header(request, ["x-opencode-instance-directory", "x-opencode-directory"]) ?? process.cwd(),
    workspaceID: header(request, ["x-opencode-instance-workspace", "x-opencode-workspace", "x-opencode-workspace-id"]),
  }
}

export const layer = Layer.effect(
  V2InstanceMiddleware,
  Effect.gen(function* () {
    const instances = yield* InstanceServiceMap
    return V2InstanceMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(instances.get(ref(request))))
      }),
    )
  }),
).pipe(Layer.provide(InstanceServiceMap.layer))

import path from "path"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { refreshOAuth } from "./oauth-refresh"

type Input = {
  root: string
  database: string
  state: string
  endpoint: string
  integrationID: string
  methodID: string
  credentialID: string
  label: string
  ready: string
  go: string
  result: string
}

const input: Input = JSON.parse(process.argv[2]!)
const data = path.join(input.root, "data")
const cache = path.join(input.root, "cache")
const layer = AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node, Bus.node]), [
  Database.node.replace(Database.configured({ path: input.database })),
  Global.node.replace(
    Global.layerWith({
      data,
      cache,
      config: path.join(input.root, "config"),
      state: input.state,
      tmp: path.join(input.root, "tmp"),
      bin: path.join(cache, "bin"),
      log: path.join(data, "log"),
      repos: path.join(data, "repos"),
    }),
  ),
])

const run = Effect.gen(function* () {
  const integrations = yield* Integration.Service
  const integrationID = Integration.ID.make(input.integrationID)
  const methodID = Integration.MethodID.make(input.methodID)
  yield* integrations.transform((editor) =>
    editor.method.update({
      integrationID,
      method: { id: methodID, type: "oauth", label: "OAuth" },
      authorize: () => Effect.die("unexpected authorization"),
      refresh: (credential) => refreshOAuth(input.endpoint, methodID, credential),
    }),
  )
  yield* Effect.promise(() => Bun.write(input.ready, String(process.pid)))
  yield* Effect.promise(async () => {
    while (!(await Bun.file(input.go).exists())) await Bun.sleep(10)
  })
  const value = yield* integrations.connection.resolve({
    type: "credential",
    id: Credential.ID.make(input.credentialID),
    label: input.label,
    method: "oauth",
  })
  yield* Effect.promise(() => Bun.write(input.result, JSON.stringify(value)))
})

await Effect.runPromise(Effect.scoped(run.pipe(Effect.provide(layer))))

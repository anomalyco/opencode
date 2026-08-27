// Deep imports: the @effect/platform-node barrel eagerly pulls in undici,
// ioredis, and node:sqlite, which runtimes such as workerd cannot load.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { FileSystem, Path } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ProcessSpawner } from "@opencode-ai/process/spawner"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { makeGlobalNode } from "./app-node.js"

export const filesystem = makeGlobalNode({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const path = makeGlobalNode({ service: Path.Path, layer: NodePath.layer, deps: [] })
export const processSpawner = makeGlobalNode({
  service: ChildProcessSpawner,
  layer: ProcessSpawner.layer,
  deps: [filesystem, path],
})
export const httpClient = makeGlobalNode({ service: HttpClient.HttpClient, layer: FetchHttpClient.layer, deps: [] })

export * as LayerNodePlatform from "./app-node-platform.js"

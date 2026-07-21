import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { FileSystem, Path } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { makeGlobalNode } from "./app-node.js"

export const filesystem = makeGlobalNode({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const path = makeGlobalNode({ service: Path.Path, layer: NodePath.layer, deps: [] })
export const httpClient = makeGlobalNode({ service: HttpClient.HttpClient, layer: FetchHttpClient.layer, deps: [] })

export * as LayerNodePlatform from "./app-node-platform.js"

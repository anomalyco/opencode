import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { FileSystem, Path } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { HttpClient } from "effect/unstable/http"
import { LayerNode } from "./layer-node"

export const filesystem = LayerNode.make({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const path = LayerNode.make({ service: Path.Path, layer: NodePath.layer, deps: [] })
export const httpClient = LayerNode.make({ service: HttpClient.HttpClient, layer: FetchHttpClient.layer, deps: [] })
export const requestExecutor = LayerNode.make({
  service: RequestExecutor.Service,
  layer: RequestExecutor.layer,
  deps: [httpClient],
})
export const llmClient = LayerNode.make({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export * as LayerNodePlatform from "./layer-node-platform"

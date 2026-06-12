import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { FetchHttpClient } from "effect/unstable/http"
import { LayerNode } from "./layer-node"

export const filesystem = LayerNode.make(NodeFileSystem.layer, [])
export const path = LayerNode.make(NodePath.layer, [])
export const httpClient = LayerNode.make(FetchHttpClient.layer, [])
export const requestExecutor = LayerNode.make(RequestExecutor.layer, [httpClient])
export const llmClient = LayerNode.make(LLMClient.layer, [requestExecutor])

export * as LayerNodePlatform from "./layer-node-platform"

import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { SpeechClient } from "@opencode/ai/speech-client"
import { TranscriptionClient } from "@opencode/ai/transcription-client"
import { Socket } from "effect/unstable/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { WebSocketConstructor } from "./websocket-constructor.js"

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: RequestExecutor.layer,
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const speechClient = makeGlobalNode({
  service: SpeechClient.Service,
  layer: SpeechClient.layer,
  deps: [requestExecutor],
})

export const transcriptionClient = makeGlobalNode({
  service: TranscriptionClient.Service,
  layer: TranscriptionClient.layer,
  deps: [requestExecutor],
})

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"

import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Credential } from "@opencode-ai/core/credential"
import { Config } from "@opencode-ai/core/config"
import { EventV2 } from "@opencode-ai/core/event"
import { Form } from "@opencode-ai/core/form"
import { Integration } from "@opencode-ai/core/integration"
import { WebSearch } from "@opencode-ai/core/websearch"
import { testEffect } from "../lib/effect"

interface WebSearchRequest {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

export const requests: WebSearchRequest[] = []
let responseBody = ""

export function resetWebSearchFixture(body: string) {
  requests.length = 0
  responseBody = body
}

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected request body: ${request.body._tag}`)
      requests.push({
        url: request.url,
        headers: request.headers,
        body: JSON.parse(new TextDecoder().decode(request.body.body)),
      })
      return HttpClientResponse.fromWeb(request, new Response(responseBody, { status: 200 }))
    }),
  ),
)

export const webSearchIntegrationTest = testEffect(
  Layer.merge(
    AppNodeBuilder.build(
      LayerNode.group([Integration.node, Credential.node, EventV2.node, Form.node, WebSearch.node]),
      [[Config.node, Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))]],
    ),
    http,
  ),
)

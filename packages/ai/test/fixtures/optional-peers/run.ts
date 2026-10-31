import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai, LLMClient } from "../../../src/effect.js"
import { AmazonBedrock, GoogleVertex } from "../../../src/providers.js"
import { dynamicResponse } from "../../lib/http.js"

const authorization: Array<string | null> = []
const layer = dynamicResponse((input) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
    authorization.push(request.headers.get("authorization"))
    return input.respond(JSON.stringify({ message: "stopped after auth" }), { status: 400 })
  }),
)

// Steps go to stderr so the parent can tell which request loaded a peer package.
const run = (step: string, model: Parameters<typeof ai.request>[0]["model"]) => {
  console.error(`step ${step}`)
  return LLMClient.generate(ai.request({ model, prompt: "Say hello." })).pipe(
    Effect.provide(layer),
    Effect.flip,
    Effect.map((error) => ({ tag: error._tag, reason: error.reason._tag, message: error.message })),
    Effect.runPromise,
  )
}

const bedrock = { baseURL: "https://bedrock-runtime.test", region: "us-east-1" }
const vertex = { project: "vertex-project", location: "global" }
const errors = {
  bedrockBearer: await run(
    "bedrock bearer",
    AmazonBedrock.configure({ ...bedrock, apiKey: "bedrock-token" }).model("amazon.nova-micro-v1:0"),
  ),
  vertexAccessToken: await run(
    "vertex access token",
    GoogleVertex.configure({ ...vertex, accessToken: "vertex-token" }).model("gemini-3.5-flash"),
  ),
  bedrockDefaultChain: await run(
    "bedrock default chain",
    AmazonBedrock.configure(bedrock).model("amazon.nova-micro-v1:0"),
  ),
  vertexADC: await run("vertex adc", GoogleVertex.configure(vertex).model("gemini-3.5-flash")),
}
console.log(JSON.stringify({ errors, authorization }))

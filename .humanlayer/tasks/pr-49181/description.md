[Design doc](https://github.com/anomalyco/opencode/blob/media-support/packages/ai/docs/media-design.md)

## Why the change

`@opencode/ai` had no shared way to represent, generate, or consume non-text media, so this lays the foundation (asset type, model selection, job handle, promise API) and rewrites Image on it as the reference for Video, Speech, and Transcription to follow.

## Special things to note

- **Public API changes in `@opencode/ai`:** `ImageRequest.options` is now `providerOptions`; `ImageInput` and `GeneratedImage` are replaced by `Media.Asset`; `MediaPart` is now `{ type: "media", media: Media.Asset }` instead of `{ mediaType, data }`. Core call sites were updated mechanically.
- **OpenAI Responses `image_generation_call` keeps the hosted tool-result carrier** because Core's `publish-llm-event.ts` consumes it and has no `media` event handling yet. Gemini inline image output, which was previously dropped on the floor, now surfaces as the new `media` LLMEvent.
- `schema/messages.ts → media.ts → route/executor-service.ts` is an accepted runtime dependency on the executor's service tag (a leaf); the split exists to break an ESM cycle. Documented in `packages/ai/AGENTS.md`.

## Change outline

Naming a model no longer repeats the modality. Configured facades are callable and return a `ModelRef`; each request namespace picks its own selector. Named selectors (`.responses`, `.chat`, `.image`, …) still work.

```diff
-const model = OpenAI.configure({ apiKey }).image("gpt-image-2")
-Image.request({ model, prompt, options: { quality: "high" } })
+const openai = OpenAI.configure({ apiKey })
+Image.request({ model: openai("gpt-image-2"), prompt, providerOptions: { quality: "high" } })
+LLM.request({ model: openai("gpt-5"), prompt })          // default route: responses
+LLM.request({ model: openai.chat("gpt-4o"), prompt })    // explicit selector still available
```

```typescript
class ModelRef<S extends Selectors> { id: ModelID; facade: S; get provider() }
interface Selectors { id: ProviderID; model: (id) => LanguageModel; image?: (id) => ImageModel }
ModelRef.facade(selectors)   // Object.assign(callable, selectors) — used by every provider file
// Image.request rejects a ref with no `image` selector at compile time (test/model-ref.types.ts)
```

One asset type in and out. `Source` is the serializable Schema; `Asset` is the runtime class with lazy decoding and a JSON codec (`AssetSchema`) so Core can persist it.

```typescript
Media.Source =
  | { type: "bytes";  data: Uint8Array; mediaType }
  | { type: "base64"; data: string;     mediaType }
  | { type: "url";    url; mediaType?; expiresAt?; headers? }
  | { type: "ref";    provider; id; mediaType? }

class Media.Asset {
  source; mediaType; kind: "image" | "video" | "audio" | "document" | "other"; info?; expiresAt?
  inline(): { mime, base64, dataUrl } | undefined     // sync, for protocol lowering
  bytes() / base64() / materialize()                  // Effect, downloads url sources via RequestExecutor
}
Media.bytes | base64 | url | ref | from | parseDataUrl | file | write | detectMediaType
```

Image runs on a new media route that reuses `Endpoint` and `Auth` but skips the LLM streaming machinery. The route, not each protocol, rejects unsupported common fields.

```text
Image.generate(request)
  ImageClient.layer
    MediaRoute.generate
      reject fields in protocol.unsupported        → AIError InvalidRequest
      protocol.body.from(request)                  → json | multipart (OpenAI edits)
      Endpoint + Auth → HttpClientRequest
      RequestExecutor.execute
      protocol.response.decode                     → ImageResponse { images: Asset[], usage?, notices? }
```

```text
Image.request({ model, prompt, images?, mask?, n?, size?, aspectRatio?, seed?, format?, providerOptions?, http? })
ImageResponse.notices: Google promptFeedback / non-STOP finish → "filtered"; Z.ai content_filter → "moderated"
```

Job handle and promise runtime are in place for the next phases; no provider uses `Job` yet.

```typescript
class Job<Response> { id; status: queued|running|completed|failed|cancelled|expired; progress?; refresh(); await({ poll? }); cancel() }
Job.Route<Response> = { status(token); result(token); cancel?(token); pollHint?(snapshot) }

import { ai, AI } from "@opencode/ai/promise"
const client = AI.make({ layer? })                  // ManagedRuntime over LLMClient + ImageClient
await client.image.generate({ model, prompt })
for await (const event of client.llm.stream(request, { signal })) …
```

Where things live:

```diff
 packages/ai/src/
+├── model-ref.ts               # ModelRef + ModelRef.facade
+├── media.ts                   # Media.Source, Media.Asset, constructors
+├── job.ts                     # Job, Job.Route, Poll
+├── promise.ts                 # @opencode/ai/promise
 ├── image.ts                   # rewritten: ImageRequest/Response/Event, Image.request/generate/stream
 ├── image-client.ts            # pass-through to MediaRoute
 ├── route/
+│   ├── media.ts               # MediaRoute.make / generate, ImageModel.fromRoute input
+│   ├── media-protocol.ts      # MediaProtocol.inline, json/multipart bodies, decodeJson
+│   └── executor-service.ts    # RequestExecutor service tag (leaf, breaks cycle)
 ├── protocols/
 │   ├── {openai,google,xai,meta,zai}-images.ts   # re-platformed on MediaRoute
 │   ├── gemini.ts              # inlineData → media event; assistant media replay
 │   ├── open-responses.ts      # assistant media → input_image / input_file
-│   └── utils/image-input.ts
+│   └── utils/media-input.ts   # decodedAsset, inlineBytes, multipart helpers
 ├── providers/*.ts             # each configure() now returns ModelRef.facade({...})
 └── schema/
     ├── messages.ts            # MediaPart carries Media.Asset; Message.media()
     ├── events.ts              # + media LLMEvent, MediaUsage union
     └── errors.ts              # + TimeoutError (Job.await)
 packages/core/src/session/     # mechanical MediaPart / provider-context / timeout mapping updates
```

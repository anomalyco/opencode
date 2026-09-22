[Design doc](https://github.com/anomalyco/opencode/blob/media-support/packages/ai/docs/media-design.md)

## Why the change

`@opencode/ai` had no shared way to represent, generate, or consume non-text media, so this lays the foundation (asset type, media route, job handle, promise API) and rewrites Image on it as the reference for Video, Speech, and Transcription to follow.

## Special things to note

- **Public API changes in `@opencode/ai`:** `ImageRequest.options` is now `providerOptions`; `ImageInput` and `GeneratedImage` are replaced by `Media.Asset`; `MediaPart` is now `{ type: "media", media: Media.Asset }` instead of `{ mediaType, data }`. Core call sites were updated mechanically. Model selection is unchanged: `openai.responses(id)` for LLM, `openai.image(id)` for images (a callable-facade `ModelRef` was tried and removed in the last commit as a second construction path).
- **OpenAI Responses `image_generation_call` keeps the hosted tool-result carrier** because Core's `publish-llm-event.ts` consumes it and has no `media` event handling yet. Gemini inline image output, which was previously dropped, now surfaces as the new `media` LLMEvent.
- `schema/messages.ts → media.ts → route/executor-service.ts` is an accepted runtime dependency on the executor's service tag (a leaf); the split breaks an ESM cycle. Documented in `packages/ai/AGENTS.md`.

## Change outline

One asset type in and out. `Source` is the serializable Schema; `Asset` is the runtime class with lazy decoding and a JSON codec (`AssetSchema`) so Core can persist it in messages.

```typescript
Media.Source =
  | { type: "bytes";  data: Uint8Array; mediaType }
  | { type: "base64"; data: string;     mediaType }
  | { type: "url";    url; mediaType?; expiresAt?; headers? }
  | { type: "ref";    provider; id; mediaType? }

class Media.Asset {
  source; mediaType; kind: "image" | "video" | "audio" | "document" | "other"; info?; expiresAt?
  inline(): { mime, base64, dataUrl } | undefined     // sync, for protocol lowering
  bytes() / base64() / materialize()                  // Effect; url sources download via RequestExecutor
}
Media.bytes | base64 | url | ref | from | parseDataUrl | file | write | detectMediaType
```

The Image request surface, and how it changed for callers:

```diff
 const openai = OpenAI.configure({ apiKey })
 Image.generate({
   model: openai.image("gpt-image-2"),
   prompt: "A robot tending a rooftop garden",
+  images: [asset], mask: asset,            // edit inputs, Media.Asset
+  n, size, aspectRatio, seed, format,       // common fields; unsupported ones fail typed per route
-  options: { quality: "high" },
+  providerOptions: { quality: "high" },     // typed per image model
 })
-response.images[0].data                     // string | Uint8Array
+response.image.bytes()                      // Media.Asset
+response.notices                            // Google safety filter → "filtered", Z.ai content_filter → "moderated"
```

Image runs on a new media route that reuses `Endpoint` and `Auth` but skips the LLM streaming machinery. The route, not each protocol, rejects unsupported common fields and owns HTTP option merging.

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

`MediaPart` now carries an `Asset`, so protocols branch on `kind`/`source` instead of sniffing mime prefixes, and Gemini image output becomes a first-class event.

```diff
 LLMEvent =
   | text-* | reasoning-* | tool-* | step-* | finish | provider-error
+  | media { media: Media.Asset }        // Gemini inlineData (was silently dropped)

 MediaPart
-  { type: "media"; mediaType; data: string | Uint8Array }
+  { type: "media"; media: Media.Asset; filename? }
```

Job handle and promise runtime are in place for the next phases; no provider uses `Job` yet.

```typescript
class Job<Response> { id; status: queued|running|completed|failed|cancelled|expired; progress?; refresh(); await({ poll? }); cancel() }
Job.Route<Response> = { status(token); result(token); cancel?(token); pollHint?(snapshot) }

import { ai, AI } from "@opencode/ai/promise"
const client = AI.make({ layer? })                  // ManagedRuntime over LLMClient + ImageClient
await client.image.generate({ model: openai.image("gpt-image-2"), prompt })
for await (const event of client.llm.stream(request, { signal })) …
```

Where things live:

```diff
 packages/ai/src/
+├── media.ts                   # Media.Source, Media.Asset, constructors
+├── job.ts                     # Job, Job.Route, Poll
+├── promise.ts                 # @opencode/ai/promise
 ├── image.ts                   # rewritten: ImageRequest/Response/Event, ImageModel.fromRoute
 ├── image-client.ts            # pass-through to MediaRoute
 ├── route/
+│   ├── media.ts               # MediaRoute.make / generate
+│   ├── media-protocol.ts      # MediaProtocol.inline, json/multipart bodies, decodeJson
+│   └── executor-service.ts    # RequestExecutor service tag (leaf, breaks cycle)
 ├── protocols/
 │   ├── {openai,google,xai,meta,zai}-images.ts   # re-platformed on MediaRoute
 │   ├── gemini.ts              # inlineData → media event; assistant media replay
 │   ├── open-responses.ts      # assistant media → input_image / input_file
-│   └── utils/image-input.ts
+│   └── utils/media-input.ts   # decodedAsset, inlineBytes, multipart helpers
 └── schema/
     ├── messages.ts            # MediaPart carries Media.Asset; Message.media()
     ├── events.ts              # + media LLMEvent, MediaUsage union
     └── errors.ts              # + TimeoutError (Job.await)
 packages/core/src/session/     # mechanical MediaPart / provider-context / timeout mapping updates
```

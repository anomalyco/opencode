# Media generation in `@opencode/ai` — public API direction

Status: proposal. Branch `media-support`.

## Goal

`@opencode/ai` becomes the one package you reach for to generate anything: text, images, video, speech, transcripts, and later music and realtime. The LLM surface already exists and is shaped by three constraints: Effect-first, used by OpenCode Core, usable externally. Media has a different priority order: **external DX first**, Effect and Promise as peers, Core as one consumer among many.

The design below is derived from a survey of the raw provider APIs (OpenAI, Gemini/Veo/Imagen, xAI, Stability, BFL, fal, Replicate, Runway, Luma, Kling, MiniMax, ElevenLabs, Deepgram, Cartesia, AssemblyAI, Lyria) and from the Vercel AI SDK v7 (`generateImage`, `generateSpeech`, `transcribe`, `experimental_generateVideo`, `ImageModelV4`/`SpeechModelV4`/`TranscriptionModelV4`/`Experimental_VideoModelV4`).

## What the survey forces

1. **Three execution shapes, everywhere.** Inline sync (OpenAI images, all TTS, Gemini), async job with polling or webhook (every video provider, BFL, fal, Replicate, AssemblyAI), and bidirectional streams (ElevenLabs/Cartesia/Deepgram WS, realtime). Video has no sync provider at all.
2. **Output is never just bytes.** base64, signed URLs with TTLs from 10 minutes (BFL) to 2 days (Veo), URLs that need auth plus redirect (Veo), separate download endpoints (Sora `/content?variant=`), raw bodies (Stability, TTS). Multi-output is the norm.
3. **Inputs have roles.** First/last frame, mask, style/subject reference, source video for edit/extend, reference audio, prior generation id, provider-side file handles (`file_id`, `gs://`, `runway://`, `mm_file://`).
4. **Partial streaming is modality-specific.** Images: a few whole partial frames. Audio: ordered chunks plus timestamp events. Jobs: status/progress/logs. Video: none.
5. **Usage is a union**: tokens, seconds, characters (often only in headers), credits, compute time.
6. **Moderation can be partial success** (Veo strips audio but returns video). Deprecations are constant (Sora API shuts down 2026-09-24, Imagen on Gemini API 2026-08-17).

## Where Vercel is weak and we should not be

- No streaming TTS at all.
- Video job handle is experimental and only `start`/`getStatus`; polling loop is inside `generateVideo` with an injectable `delay`.
- Unsupported inputs become silent `warnings` arrays, so a request can succeed while dropping your mask.
- `n` is fanned out into hidden parallel calls (`maxImagesPerCall`), which obscures cost and idempotency.
- Each modality has its own bespoke result type; the file abstraction is a lazy base64/bytes pair with no URL, expiry, or provider ref.
- Effect's own `unstable/ai` has no media generation. Nothing in the Effect ecosystem owns this.

## Design principles

- **Same shape as LLM.** `X.request(...)` → Schema class; `X.generate(request)` / `X.stream(request)`; `XClient.Service` + `layer`; typed `AIError`. If you know `LLM`, you know `Video`.
- **Execution shape is route policy, not API shape.** `Image.generate` returns an image whether the provider is inline or queued. Job control is available uniformly when you want it.
- **Errors, not warnings.** Unsupported common fields fail at the protocol boundary with a typed `AIError`, as the LLM routes do today. Provider-side partial results (filtered audio, moderated sample) surface as `notices` on the response, never as silent drops.
- **One asset type in, one asset type out**, shared with LLM messages and tool results.
- **Typed per-model options**, no hidden fan-out, no implicit retries that spend money.
- **Promise API is one mechanism for the whole package**, not a media-only wrapper.
- **One construction path per model.** Media models come from per-modality selectors on the configured facade (`openai.image("gpt-image-2")`), the same shape as `openai.responses("gpt-5")`.

## Public API

### Model selection

A model value is built as `OpenAI.configure({ apiKey }).responses("gpt-5")` or `.image("gpt-image-2")`: `configure` fixes credentials, endpoint, and defaults; the selector fixes which of the provider's APIs to hit and binds the typed `providerOptions` generic. Media follows the same shape with one selector per modality — `openai.image(id)` today, `.video(id)` / `.speech(id)` / `.transcription(id)` as those modalities land — mirroring `openai.responses(id)`. `Image.request` accepts `ImageModel` only, exactly as `LLM.request` accepts `LanguageModel`.

```ts
import { OpenAI, Google } from "@opencode/ai/providers"

const openai = OpenAI.configure({ apiKey })      // OpenAI(...) alone uses env auth (OPENAI_API_KEY)

LLM.request({ model: openai.responses("gpt-5"), prompt })
Image.request({ model: openai.image("gpt-image-2"), prompt })
Video.request({ model: google.video("veo-3.1-generate-preview"), prompt })
Speech.request({ model: openai.speech("gpt-4o-mini-tts"), text })
Transcription.request({ model: openai.transcription("gpt-4o-transcribe"), audio })
```

The request namespace and the selector share one word (`Image.request` + `.image(...)`). That redundancy is accepted: a callable facade returning a lazily resolved ref would be a second way to construct the same model, and the type machinery to infer `providerOptions` through it is not worth one word. Where a provider has two APIs for one modality, the selectors stay explicit (`openai.chat`, a future `google.imagen`), and one default per modality per provider is part of the facade definition (OpenAI image → Images API, Google image → Gemini-native since Imagen on the Gemini API shuts down 2026-08-17). Provider package entrypoints keep `model(modelID, settings)` per modality-specific path, e.g. `@opencode/ai/providers/openai/responses`.

### `Media` — the asset type

Replaces `MediaPart.data: string | Uint8Array`, `ImageInput`, `GeneratedImage`, and aligns `Tool.FileContent`.

```ts
import { Media } from "@opencode/ai"

Media.Source =
  | { type: "bytes";  data: Uint8Array; mediaType: string }
  | { type: "base64"; data: string;     mediaType: string }
  | { type: "url";    url: string; mediaType?: string; expiresAt?: number; headers?: Record<string, string> }
  | { type: "ref";    provider: ProviderID; id: string; mediaType?: string }   // file_id, gs://, runway://, prior generation

class Media.Asset {
  readonly source: Media.Source
  readonly mediaType: string                    // always resolved (sniffed when the provider omits it)
  readonly kind: "image" | "video" | "audio" | "document" | "other"
  readonly info?: { width?; height?; durationSeconds?; sampleRate?; channels?; encoding?; format? }
  readonly expiresAt?: number
  readonly providerMetadata?: ProviderMetadata

  bytes(): Effect<Uint8Array, AIError, RequestExecutor.Service>   // downloads/decodes lazily, cached
  base64(): Effect<string, AIError, RequestExecutor.Service>
  dataUrl(): Effect<string, AIError, RequestExecutor.Service>
  materialize(): Effect<Media.Asset, AIError, RequestExecutor.Service>  // url/ref → bytes, before the URL dies
}

Media.bytes(data, mediaType?)      Media.base64(data, mediaType?)
Media.url(url, options?)           Media.ref(provider, id)
Media.file(path)                   // Bun/Node: reads + sniffs; Effect FileSystem variant for layers
Media.write(asset, path)           // convenience, uses FileSystem
```

Raw-PCM outputs (Gemini TTS, Cartesia raw, Deepgram WS) carry `info.encoding/sampleRate/channels` because there is no container header.

### Modality namespaces

Each namespace mirrors `LLM` exactly.

```ts
import { Image, Video, Speech, Transcription } from "@opencode/ai"
import { OpenAI, Google, ElevenLabs, Fal } from "@opencode/ai/providers"
```

#### Image

```ts
const request = Image.request({
  model: openai.image("gpt-image-2"),
  prompt: "A robot tending a rooftop garden",
  images: [Media.file("./ref.png")],           // references / edit sources
  mask: Media.file("./mask.png"),
  n: 2,
  size: "1536x1024",                            // or aspectRatio: "3:2"
  seed: 7,
  format: "webp",
  providerOptions: { quality: "high", background: "transparent" },   // typed per model
})

const response = yield* Image.generate(request)   // ImageResponse
response.image                                    // Media.Asset (first)
response.images                                   // Media.Asset[]
response.usage                                    // Usage union (see below)
response.notices                                  // moderation / partial-result notices

yield* Image.stream(request)                      // Stream<ImageEvent>
// ImageEvent: job-queued | job-progress | image-partial { index, image } | image { index, image } | finish { usage }
```

Editing is not a separate function; `images`/`mask` on the request select the edit path in the route (OpenAI `/images/edits`, Gemini multimodal parts, xAI `/images/edits`). Routes that cannot honor `mask` fail with `Unsupported`.

#### Video

```ts
const request = Video.request({
  model: google.video("veo-3.1-generate-preview"),
  prompt: "Panning wide shot of a calico kitten sleeping in the sunshine",
  frames: { first: Media.file("./start.png"), last: Media.file("./end.png") },
  references: [Media.url("https://…/style.png")],
  video: Media.ref("openai", "video_123"),      // edit / extend / remix source
  durationSeconds: 8,
  aspectRatio: "16:9",
  resolution: "1080p",
  audio: true,
  n: 1,
  providerOptions: { personGeneration: "dont_allow", negativePrompt: "text, watermark" },
})

// Simple: wait for it.
const response = yield* Video.generate(request, { poll: { interval: "10 seconds", timeout: "10 minutes" } })
response.video                                     // Media.Asset (url with expiresAt, or bytes when the route downloads)
yield* response.video.materialize()                // pull bytes before the URL expires

// Explicit job control.
const job = yield* Video.start(request)            // Job<VideoResponse>
job.id; job.status; job.progress; job.token        // token is serializable JSON
yield* job.await({ poll })                         // VideoResponse
yield* job.cancel()

// Resume from another process.
const resumed = yield* Video.resume(model, token)  // Job<VideoResponse>

// Progress as a stream.
yield* Video.stream(request)                       // Stream<VideoEvent>: job-queued { position } | job-progress { progress, logs } | video { index, video } | finish
```

Webhooks: `Video.complete(model, token, webhook)` finishes a job from a webhook payload without polling. Token shape is route-owned and opaque (Veo operation name, fal `response_url`, Runway task id).

#### Speech (TTS)

```ts
const request = Speech.request({
  model: elevenlabs.speech("eleven_v3"),
  text: "Hello from OpenCode.",
  voice: "JBFqnCBsd6RMkjVDRZzb",                  // name, uuid, or { id } — provider-normalized
  format: "mp3",                                   // mp3 | wav | pcm | opus | aac | flac | (string & {})
  speed: 1.0,
  language: "en",
  instructions: "Warm, unhurried.",
  providerOptions: { stability: 0.5 },
})

const response = yield* Speech.generate(request)   // SpeechResponse: audio: Media.Asset, timestamps?, usage
yield* Speech.stream(request)                      // Stream<SpeechEvent>: audio-delta { chunk } | timestamps { words } | finish
```

Streaming TTS is first-class on day one: OpenAI `stream_format: sse`, ElevenLabs `/stream`, Cartesia SSE, Deepgram chunked. Input-streaming TTS (WS, text arrives incrementally) is a later `Speech.session(...)` scoped resource, not part of `generate`.

#### Transcription (STT)

```ts
const request = Transcription.request({
  model: openai.transcription("gpt-4o-transcribe"),
  audio: Media.file("./call.wav"),
  language: "en",
  prompt: "Names: Shoubhit, OpenCode.",
  timestamps: "word",                              // none | segment | word
  diarize: true,
  providerOptions: { chunkingStrategy: "auto" },
})

const response = yield* Transcription.generate(request)
response.text; response.segments; response.words; response.language; response.durationSeconds
yield* Transcription.stream(request)               // Stream<TranscriptionEvent>: text-delta | segment | finish
```

Realtime STT over WebSocket is the same future `session` shape as input-streaming TTS.

### `Job` — shared async execution

```ts
class Job<Response> {
  readonly id: string
  readonly model: MediaModel
  readonly token: unknown                          // route-owned serializable JSON
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "expired"
  readonly progress?: number                       // 0..1, normalized
  readonly position?: number
  readonly expiresAt?: number
  refresh(): Effect<Job<Response>, AIError>
  await(options?: { poll?: Poll }): Effect<Response, AIError>
  cancel(): Effect<void, AIError>
  events(options?): Stream<JobEvent, AIError>
}

Poll = { interval?: Duration; timeout?: Duration; schedule?: Schedule }   // route may override from provider hints (`openai-poll-after-ms`)
```

`Job` is not video-specific. Image routes on BFL, fal, and Replicate are jobs; `Image.start` exists for them. A route declares itself `inline` or `job`; `generate` on a job route is `start` then `await`.

### Usage

```ts
Usage =
  | { type: "tokens"; input; output; total; details? }
  | { type: "seconds"; seconds }
  | { type: "characters"; characters }
  | { type: "credits"; credits }
  | { type: "compute"; seconds }
```

Header-only usage (ElevenLabs `character-cost`, Deepgram `dg-char-count`) is lifted into `usage` by the route.

### Promise API — `@opencode/ai/promise`

Mirrors the `packages/plugin/src/effect` and `packages/plugin/src/promise` split that already exists in this repo. One mechanism for LLM and media.

```ts
import { AI } from "@opencode/ai/promise"

const ai = AI.make()                                // ManagedRuntime over RequestExecutor.fetchLayer + all clients
// AI.make({ layer }) to inject a custom executor / recorder / middleware

const image = await ai.image.generate({ model, prompt })
await image.image.bytes()

for await (const event of ai.speech.stream({ model, text, voice })) { … }

const job = await ai.video.start({ model, prompt })
const video = await job.await({ poll: { interval: 10_000 }, signal })
const resumed = ai.video.resume(model, JSON.parse(saved))

const text = await ai.llm.generate({ model, prompt })   // closes today's gap: LLM has no promise API either
for await (const event of ai.llm.stream(request)) { … }

await ai.dispose()
```

Streams become `AsyncIterable` via `Stream.toAsyncIterable`. `AIError` is thrown as-is. `AbortSignal` maps to interruption. Nothing in `src/*` except this entrypoint knows about promises.

### Providers

Existing facades gain per-modality selectors; the modality routes each facade provides:

| Facade | llm | image | video | speech | transcription | other |
|---|---|---|---|---|---|---|
| `OpenAI` | responses (default), chat | Images API | Sora (deprecated 2026-09-24) | ✓ | ✓ | |
| `Google` | Gemini | Gemini-native (default), `imagen` | Veo | Gemini TTS | Gemini transcribe | |
| `XAI` | ✓ | ✓ | ✓ | | | |
| `ElevenLabs` | | | | ✓ | Scribe | soundEffect, music |
| `Fal` | | ✓ | ✓ | | | |
| `Replicate`, `Runway`, `Luma`, `Kling`, `MiniMax`, `Deepgram`, `Cartesia`, `AssemblyAI`, `BlackForestLabs`, `Stability` | | per provider | | | | |

New facades follow the existing one-file-per-provider rule. Package entrypoints are modality-specific, such as `@opencode/ai/providers/openai/images`, and return the concrete model.

`ImageModel<Options>` already gives typed `providerOptions` per model; `VideoModel`, `SpeechModel`, `TranscriptionModel` follow the same generic. A shared `MediaModel` union is what `Job` and the promise client key on.

### Routes and protocols

Media does not fit the LLM four-axis route (SSE frames → event state machine) except for streaming TTS/STT. Reuse `Endpoint`, `Auth`, `Framing`, `RequestExecutor`, and add media protocol kinds:

- `MediaProtocol.inline` — `body.from(request)` (JSON, multipart, or query), `response.decode(response)` (JSON, or binary body → `Media.Asset`).
- `MediaProtocol.job` — `start`, `status`, `result`, `cancel`, optional `download`, `pollHint`, `token` schema.
- `MediaProtocol.stream` — framing + `step` state machine emitting modality events, same discipline as LLM protocols.

`Route.make` for media composes one protocol kind with endpoint/auth. The existing `ImageRoute { generate(request, execute) }` is the ad-hoc version of `inline` and gets folded in.

### LLM integration

- `MediaPart` becomes `{ type: "media"; media: Media.Asset; … }` so protocols branch on `kind` and can pass `url`/`ref` sources through natively (OpenAI `image_url`, Gemini `fileData`).
- New `LLMEvent`s: `media { media: Media.Asset }` so Gemini inline image output is first-class instead of dropped. OpenAI Responses `image_generation_call` keeps its single carrier — the provider-executed `tool-result` with `file` content — because Core consumes hosted tool-result content today and has no `media` event handling yet; it switches to the `media` carrier when Core adopts the event, so the image is never emitted twice.
- `Message.assistant([...])` accepts media parts; Gemini multi-turn image editing replays them.
- `Tool.FileContent` aligns with `Media.Source`.

## Decisions

All settled:

1. **Per-modality selectors** (`openai.image(id)`, `.video`, `.speech`, `.transcription`) name media models, mirroring `openai.responses(id)`. The one-word overlap with the request namespace is accepted over a callable-facade `ModelRef` as a second construction path.
2. **`providerOptions` everywhere** (rename current `Image.options`) for consistency with LLM.
3. **No hidden `n` fan-out.** `n` lowers natively; routes that cannot do `n > 1` fail typed. Callers use `Effect.all` / `Promise.all` explicitly.
4. **Errors over warnings** for unsupported common fields; `notices` for provider-side partial results only.
5. **`Media.Asset` is a class** (lazy bytes, cached) with `Media.Source` as the serializable Schema for wire/persistence. `Asset.from(source)` / `asset.source` round-trip losslessly. Same pattern as `LanguageModel` today.
6. **Promise entrypoint**: `@opencode/ai/promise` exporting `AI.make(options?: { layer? })` plus a module-level default `ai` for scripts, covering LLM too.
7. **Modality set for v1**: `Image`, `Video`, `Speech`, `Transcription`. `Music`/`SoundEffect` and `session` (bidirectional WS, realtime) are designed-for but deferred.
8. **Sora is skipped** (API shuts down 2026-09-24). Video launches with Veo, xAI, fal, Runway.

## Build order

Foundation + Image ship together as the reference implementation, serially. Video, Speech, and Transcription then proceed in parallel on separate branches. Image jobs and partial streaming come last, after Video has hardened `Job`.

## Phasing

1. **Foundation** — per-modality selectors, `Media`, `Job`, `Poll`, `Usage` union, `MediaProtocol` kinds, `@opencode/ai/promise` with `llm` + `image`. Port the five existing image protocols onto it. Unify `MediaPart` and add the `media` LLM event (fixes Gemini image output being dropped).
2. **Video** — Veo, xAI, fal, Runway first. Then Luma, Kling, MiniMax, Replicate.
3. **Speech + Transcription** — OpenAI, ElevenLabs, Gemini TTS, Deepgram, Cartesia, AssemblyAI. Streaming TTS from the start.
4. **Image jobs and partials** — BFL, fal, Replicate, Stability; OpenAI `partial_images` streaming.
5. **Later** — ElevenLabs music/SFX, Lyria, `Speech.session` / `Transcription.session`, realtime.

Core adoption (session attachments beyond png/jpeg/gif/webp/pdf, image-generation tool, TUI rendering) comes after phase 1 and is a Core concern.

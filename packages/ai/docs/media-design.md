# Media generation in `@opencode/ai` — public API direction

Status: phases 1–3 implemented (Speech and Transcription); phases 4–5 proposal.

## Goal

`@opencode/ai` becomes the one package you reach for to generate anything: text, images, video, speech, transcripts, and later music and realtime. The LLM surface already exists and is shaped by three constraints: Effect-first, used by OpenCode Core, usable externally. Media has a different priority order: **external DX first**, Effect and Promise as peers, Core as one consumer among many.

The design below is derived from a survey of the raw provider APIs (OpenAI, Gemini/Veo/Imagen, xAI, Stability, BFL, fal, Replicate, Runway, Luma, Kling, MiniMax, ElevenLabs, Deepgram, Cartesia, AssemblyAI, Lyria) and of existing multi-provider SDKs.

## What the survey forces

1. **Three execution shapes, everywhere.** Inline sync (OpenAI images, all TTS, Gemini), async job with polling or webhook (every video provider, BFL, fal, Replicate, AssemblyAI), and bidirectional streams (ElevenLabs/Cartesia/Deepgram WS, realtime). Video has no sync provider at all.
2. **Output is never just bytes.** base64, signed URLs with TTLs from 10 minutes (BFL) to 2 days (Veo), URLs that need auth plus redirect (Veo), separate download endpoints (Sora `/content?variant=`), raw bodies (Stability, TTS). Multi-output is the norm.
3. **Inputs have roles.** First/last frame, mask, style/subject reference, source video for edit/extend, reference audio, prior generation id, provider-side file handles (`file_id`, `gs://`, `runway://`, `mm_file://`).
4. **Partial streaming is modality-specific.** Images: a few whole partial frames. Audio: ordered chunks plus timestamp events. Jobs: status/progress/logs. Video: none.
5. **Usage is a union**: tokens, seconds, characters (often only in headers), credits, compute time.
6. **Moderation can be partial success** (Veo strips audio but returns video). Deprecations are constant (Sora API shuts down 2026-09-24, Imagen on Gemini API 2026-08-17).

## Where existing SDKs are weak and we should not be

- No streaming TTS.
- Video handles are experimental start/status pairs; the polling loop lives inside the generate call.
- Unsupported inputs become silent warnings arrays, so a request can succeed while dropping your mask.
- `n` is fanned out into hidden parallel calls, which obscures cost and idempotency.
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
  | { type: "url";    url: string; mediaType?: string; expiresAt?: number }
  | { type: "ref";    provider: ProviderID; id: string; mediaType?: string }   // file_id, gs://, runway://, prior generation

class Media.Asset {
  readonly source: Media.Source
  readonly mediaType: string                    // always resolved (sniffed when the provider omits it)
  readonly kind: "image" | "video" | "audio" | "document" | "other"
  readonly info?: { width?; height?; durationSeconds?; sampleRate?; channels?; encoding?; format? }
  readonly expiresAt?: number
  readonly providerMetadata?: ProviderMetadata
  readonly headers?: Record<string, string>     // transient download credentials (Veo); never in source/JSON

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
// ImageEvent: generation-queued | generation-progress | image-partial { index, image } | image { index, image } | finish { usage }
```

Editing is not a separate function; `images`/`mask` on the request select the edit path in the route (OpenAI `/images/edits`, Gemini multimodal parts, xAI `/images/edits`). Routes that cannot honor `mask` fail with `Unsupported`.

#### Video

Shipped in phase 2 (`src/video.ts`, `src/video-client.ts`, protocols `google-video`, `xai-video`, `fal-video`, `runway-video`).

```ts
const request = Video.request({
  model: google.video("veo-3.1-generate-preview"),
  prompt: "Panning wide shot of a calico kitten sleeping in the sunshine",
  frames: { first: Media.file("./start.png"), last: Media.file("./end.png") },
  references: [Media.file("./style.png")],
  video: Media.bytes(previous, "video/mp4"),    // edit / extend source
  durationSeconds: 8,
  aspectRatio: "16:9",
  resolution: "1080p",
  audio: true,
  n: 1,
  seed: 7,
  negativePrompt: "text, watermark",            // common, not provider-native
  providerOptions: { personGeneration: "allow_adult" },
})

// Simple: wait for it.
const response = yield* Video.generate(request, { poll: { interval: "10 seconds", timeout: "10 minutes" } })
response.video                                     // Media.Asset: url with expiresAt (+ transient `headers` for Veo downloads)
response.usage                                     // credits on Runway; the other three report none
response.notices                                   // Veo raiMediaFilteredReasons → filtered, xAI respect_moderation → moderated
yield* response.video.materialize()                // pull bytes before the URL expires

// Explicit generation control.
const generation = yield* Video.start(request)     // Generation<VideoResponse>
generation.id; generation.status; generation.progress; generation.position; generation.token
yield* generation.await({ poll })                  // VideoResponse
yield* generation.cancel()                         // fal PUT cancel_url, Runway DELETE /tasks/{id}; no-op for Veo and xAI

// Resume from another process. The token is validated against the route's codec and refreshed once.
const resumed = yield* Video.resume(model, JSON.parse(saved))

// Progress as a stream.
yield* Video.stream(request, { poll })             // Stream<VideoEvent>: generation-queued { id, position } | generation-progress { id, progress } | video { index, video } | finish { usage, notices }
```

Tokens are route-owned JSON: Veo `{ operation }`, xAI `{ requestID }`, Runway `{ taskID }`, fal
`{ requestID, statusURL, responseURL, cancelURL }` (fal's follow-up URLs are authoritative and absolute). Common-field
lowering per provider: Veo takes inline media only and rejects `audio: false` and `n > 1`; xAI rejects `seed` and
`negativePrompt` and routes a `video` input to edits or (`providerOptions.mode: "extend"`) extensions; fal rejects
`durationSeconds`, `references`, and `frames.last` because the field names and enums differ per model; Runway passes
`aspectRatio` through as its pixel `ratio` and rejects `n`.

Deferred: `Video.complete(model, token, webhook)` (finish from a webhook payload without polling) and provider poll
hints (none of the four providers emit one). Later providers: Luma, Kling, MiniMax, Replicate.

#### Speech (TTS)

Shipped in phase 3 (`src/speech.ts`, `src/speech-client.ts`, protocols `openai-speech`, `google-speech`,
`elevenlabs-speech`, `cartesia-speech`, `deepgram-speech`; new `ElevenLabs`, `Cartesia`, and `Deepgram` facades).

```ts
const request = Speech.request({
  model: elevenlabs.speech("eleven_flash_v2_5"),
  text: "Hello from OpenCode.",
  voice: "JBFqnCBsd6RMkjVDRZzb",                  // provider-native identifier, or { id }
  format: "mp3",                                   // mp3 | wav | pcm | opus | aac | flac | (string & {})
  speed: 1.0,
  language: "en",
  instructions: "Warm, unhurried.",                // only OpenAI; elsewhere fails typed
  timestamps: true,                                // request alignment; routes without it fail typed
  providerOptions: { voice_settings: { stability: 0.5 } },
})

const response = yield* Speech.generate(request)   // SpeechResponse: audio: Media.Asset, timestamps?, usage?, providerMetadata?
yield* Speech.stream(request)                      // Stream<SpeechEvent>: audio-delta { chunk } | timestamps { items } | finish { audio, usage? }
```

Execution is `MediaProtocol.stream` for every provider: one request whose body is framed and folded by a `step`
state machine, with `generate` running the same stream and collecting it. The route submits the request with its
`mode` (`"generate" | "stream"`), which lets one provider stay one protocol — OpenAI adds `stream_format: "sse"` (except `tts-1`/`tts-1-hd`, which stream raw bytes), ElevenLabs appends
`/stream`, Cartesia switches `/tts/bytes` to `/tts/sse`, Gemini switches `generateContent` to
`streamGenerateContent`. The terminal `finish` event carries the assembled asset (every provider's stream is
concatenable chunks), so stream consumers also get the whole file and `generate` is just "take `finish`, gather
`timestamps`". The cost is memory: a stream holds every chunk until `finish`, so even a consumer that only plays deltas
keeps the whole clip in memory. That is bounded by the providers' input text limits (a few minutes of audio); a
long-form or session API would need an opt-out.

**Voice.** `voice?: string | { id: string }`. A string is passed through as the provider's native identifier — a
name on OpenAI and Gemini, a voice id on ElevenLabs (path segment) and Cartesia. `{ id }` selects an OpenAI custom
voice and is treated as the plain string on routes that do not distinguish custom from built-in. Deepgram's voice is
the model id (`aura-2-thalia-en`), so `voice` is `unsupported` there. There is no cross-provider voice catalog or
name→id resolution. Multi-speaker (Gemini `speechConfig.multiSpeakerVoiceConfig`) and per-voice settings
(ElevenLabs `voice_settings`) go through `providerOptions`.

**Format and PCM.** `format` is container-level; provider sample rates and bitrates live under `providerOptions`
(ElevenLabs `outputFormat`, Cartesia `sampleRate`/`bitRate`/`encoding`, Deepgram `encoding`/`container`/`sampleRate`/
`bitRate`). Each protocol maps `format` to its native value (ElevenLabs `mp3_44100_128`/`pcm_24000`/`wav_24000`/
`opus_48000_64`, Cartesia `{ container, encoding, sample_rate }`, Deepgram `encoding`+`container`) and declares the
asset's media type rather than sniffing, because headerless PCM can look like an MPEG frame sync. Headerless PCM
always carries `info.encoding`, `info.sampleRate`, and `info.channels`; its media type is the provider's declaration
(Gemini `audio/L16;codec=pcm;rate=24000`, Deepgram's `content-type`) or `audio/pcm`. Gemini returns PCM only, so any
other `format` is rejected rather than wrapped as WAV by the route. Every `format` value a route cannot produce (unknown
to it, a container on Cartesia SSE, WAV on an ElevenLabs stream, anything but PCM on Gemini) fails the same way as an
unsupported field: `UnsupportedOperation` with `operation: "media.format"`.

**Timestamps.** `timestamps: true` on the request asks for alignment. ElevenLabs selects the `with-timestamps`
endpoints (character-level, NDJSON when streaming); Cartesia sets `add_timestamps` on `/tts/sse` (word-level; a
`generate` with timestamps collects the SSE stream). OpenAI, Gemini, and Deepgram reject it.

Common-field lowering per provider:

| Provider | `voice` | `speed` | `language` | `instructions` | `timestamps` | Usage |
|---|---|---|---|---|---|---|
| OpenAI | `voice` (name or `{ id }`) | `speed` | unsupported | `instructions` | unsupported | `tokens` from SSE `speech.audio.done` only |
| Gemini | `prebuiltVoiceConfig.voiceName` | unsupported | `speechConfig.languageCode` | unsupported (direct in text) | unsupported | `tokens` from `usageMetadata` |
| ElevenLabs | path voice id (required) | `voice_settings.speed` | `language_code` | unsupported | `with-timestamps` | `credits` from `character-cost` header |
| Cartesia | `voice` (required) | `generation_config.speed` | `language` | unsupported | `add_timestamps` | none |
| Deepgram | unsupported (voice is the model) | `speed` query | unsupported | unsupported | unsupported | `characters` from `dg-char-count` header |

Deferred: `Speech.session(...)` — input-streaming TTS where text arrives incrementally over a WebSocket (ElevenLabs
`stream-input`, Cartesia WebSocket contexts, Deepgram WebSocket speak) — is a separate scoped resource, not part of
`generate`/`stream`, and ships with the realtime work in phase 5.

#### Transcription (STT)

Shipped as the second half of phase 3 (`src/transcription.ts`, `src/transcription-client.ts`, protocols
`openai-transcription`, `google-transcription`, `deepgram-transcription`, `assemblyai-transcription`; new `AssemblyAI`
facade).

```ts
const request = Transcription.request({
  model: openai.transcription("gpt-4o-transcribe-diarize"),
  audio: yield* Media.file("./call.wav"),
  language: "en",                                  // provider-native passthrough
  timestamps: "segment",                           // none | segment | word
  diarize: true,
  speakers: 2,                                     // expected count, hint only (AssemblyAI)
  providerOptions: { known_speaker_names: ["agent"] },
})

const response = yield* Transcription.generate(request)
response.text; response.segments; response.words; response.language; response.durationSeconds; response.usage
yield* Transcription.stream(request)               // Stream<TranscriptionEvent>: generation-queued | generation-progress | text-delta | segment | finish
const generation = yield* Transcription.start(request) // queued routes only
yield* Transcription.resume(model, token)
```

Transcription is the first modality whose providers span all three protocol kinds, and it needed no fourth kind.
Every `MediaRoute` now carries its `kind`; `TranscriptionRoute` is the union of the inline, stream, and queued routes;
`TranscriptionModel.fromRoute` is overloaded per protocol kind (arity picks the overload: `<Options>`,
`<Options, Frame, State>`, `<Options, Token>`) and composes through `MediaRoute.inline` / `stream` / `queued`; and
`TranscriptionClient` dispatches on `route.kind`. `generate` on a queued route is `start` then `await`; `stream` on an
inline route is the response as a single `finish`, and on a queued route it is the status observations followed by
`finish`. `start` / `resume` on a non-queued route fail with `UnsupportedOperation` (`transcription.start`). The
`finish` event carries the whole transcript (text, segments, words, language, duration, usage), so the stream route's
`collect` is just "take `finish`".

The route layer gained a `binary` body with array-valued `query` (Deepgram) and `Queued.start.prepare` (AssemblyAI's
upload); `packages/ai/AGENTS.md` (Media Routes) describes both.

Settled rules:

- **Timestamps.** A granularity the selected route or model cannot produce fails as `UnsupportedOperation`
  (`media.timestamps`), following Speech; a route that returns more than asked (Deepgram and AssemblyAI always return
  words) is not stripped. Segments always carry start and end times: Gemini times each transcription part from its
  word offsets, so segment timestamps and diarization also request word offsets there.
- **Diarization.** `diarize` means segments (and words, where the provider labels them) carry `speaker`. Labels are
  provider-native strings — OpenAI `A` or a known speaker name, Deepgram `0`, Gemini `spk:0`, AssemblyAI `A` — with no
  cross-provider speaker model. `speakers` is a hint; only AssemblyAI (`speakers_expected`) accepts it.
- **Language** is passed through (`language`, OpenAI `gpt-transcribe` `languages[]`, Gemini `languageCodes`,
  AssemblyAI `language_code`). `response.language` is the provider's own value, lowercased but not normalized: an
  ISO code on most routes, `english` from whisper-1, `en_us` from AssemblyAI. Deepgram and AssemblyAI assume English
  unless asked to detect, so a missing `language` enables their detection.
- **Gemini** requires a transcribe model; other model ids fail with `UnsupportedOperation` before the call, because
  general models ignore `audioTranscriptionConfig` and answer conversationally. Streamed chunks carry whole speaker
  turns (one part per turn), which join with a space.
- **Streaming inline providers** emit only `finish`; deltas are never faked.
- **Units.** AssemblyAI milliseconds and Gemini protobuf durations (`"0.400s"`) are normalized to seconds at the
  protocol boundary.

| Provider | Kind | Audio input | `timestamps` | `diarize` | Unsupported | Usage |
|---|---|---|---|---|---|---|
| OpenAI | stream (`stream: true` in `stream` mode) | multipart `file` (inline only) | `whisper-1` (`verbose_json`); diarize model: `segment` | `gpt-4o-transcribe-diarize` (`diarized_json`) | `speakers`; `prompt` on the diarize model; streaming on `whisper-1` | `tokens` or `seconds` |
| Gemini | stream (`generateContent` / `streamGenerateContent`) | `inlineData` or Gemini Files `fileData` | `audioTranscriptionConfig.wordTimestamp` | `audioTranscriptionConfig.diarization` | `prompt`, `speakers` | `tokens` |
| Deepgram | inline | raw body, or JSON `{ url }` | words always; `segment` → `utterances` | `diarize_model=latest` + `utterances` | `prompt`, `speakers` | `seconds` (`metadata.duration`) |
| AssemblyAI | queued (upload → submit → poll) | `/v2/upload` then `audio_url`, or a URL | words always; `segment` → `speaker_labels` | `speaker_labels` | — | `seconds` (`audio_duration`) |

Deferred: `Transcription.session(...)` — realtime STT over WebSocket (Deepgram live, AssemblyAI streaming, ElevenLabs
realtime, OpenAI realtime transcription) — is the same future scoped `session` shape as input-streaming TTS and ships
with the realtime work in phase 5. ElevenLabs Scribe is not implemented yet.

### `Generation` — shared async execution

```ts
class Generation<Response> {
  readonly id: string
  readonly route: GenerationRoute<Response>        // token-free: { status, result, cancel?: Effect; pollHint? } closed over the decoded token
  readonly token: unknown                          // route-owned serializable JSON
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "expired"
  readonly progress?: number                       // 0..1, normalized
  readonly position?: number
  readonly expiresAt?: number
  refresh(): Effect<Generation<Response>, AIError>
  result(): Effect<Response, AIError>
  await(options?: AwaitOptions): Effect<Response, AIError>
  cancel(): Effect<void, AIError>
  events(options?: AwaitOptions): Stream<GenerationEvent, AIError>   // fails with Timeout past poll.timeout, checked per observation
}

AwaitOptions = { poll?: Poll }
Poll = { interval?: Duration; timeout?: Duration; schedule?: Schedule }   // route may override from provider hints (`openai-poll-after-ms`)
```

`Generation` is not video-specific. Image routes on BFL, fal, and Replicate are queued; `Image.start` exists for them. A route declares itself `inline` or `queued`; `generate` on a queued route is `start` then `await`.

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

const generation = await ai.video.start({ model, prompt })
const video = await generation.await({ poll: { interval: 10_000 }, signal })
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
| `Google` | Gemini | Gemini-native (default), `imagen` | Veo | Gemini TTS | `gemini-3.5-transcribe` | |
| `XAI` | ✓ | ✓ | ✓ | | | |
| `ElevenLabs` | | | | ✓ | Scribe | soundEffect, music |
| `Cartesia` | | | | ✓ | | |
| `Deepgram` | | | | Aura | ✓ | |
| `Fal` | | ✓ | ✓ | | | |
| `AssemblyAI` | | | | | ✓ (queued) | |
| `Replicate`, `Runway`, `Luma`, `Kling`, `MiniMax`, `BlackForestLabs`, `Stability` | | per provider | | | | |

New facades follow the existing one-file-per-provider rule. Package entrypoints are modality-specific, such as `@opencode/ai/providers/openai/images`, and return the concrete model.

`ImageModel<Options>` already gives typed `providerOptions` per model; `VideoModel`, `SpeechModel`, `TranscriptionModel` follow the same generic. A shared `MediaModel` union is what `Generation` and the promise client key on.

### Routes and protocols

Media does not fit the LLM four-axis route (SSE frames → event state machine) except for streaming TTS/STT. Reuse `Endpoint`, `Auth`, `Framing`, `RequestExecutor`, and add media protocol kinds:

- `MediaProtocol.inline` — `body.from(request)` (JSON, multipart, or query), `response.decode(response)` (JSON, or binary body → `Media.Asset`).
- `MediaProtocol.queued` — `start` (body + decode to `{ token, snapshot }`), `status`, `result`, optional `cancel`, `pollHint`, and a `token` codec. `result` is always a separate GET (against the status document for Veo/xAI/Runway, fal's `response_url` otherwise) so `await` after `start` and after `resume` share one path. `PollContext.auth` hands the auth headers the route sent to the protocol for output URLs that need them (Veo downloads); they become transient `Media.Asset.headers`, never part of `source`. There is no separate `download` step: `Media.Asset.bytes()` downloads through the executor with those headers. `MediaRoute.inline(...)` / `MediaRoute.queued(...)` compose each kind with endpoint and auth; the queued route decodes the token once and hands `Generation` a token-free `{ status, result, cancel? }`.
- `MediaProtocol.stream` — `body.from(request)` over the request plus its `mode`, `frames` (a function that picks the framing for the call: `Framing.sse`, `lines`, `document`, or the raw bytes), fresh per-response `initial()` state, `step` emitting modality events, and `finish(state, context)` — with the observed response for header-only usage — emitting exactly one terminal event or failing as an incomplete stream. The route fills `reason.http` on stream errors. `MediaRoute.stream(...)` exposes `stream` and `generate` (the same stream folded by the modality's `collect`).

`MediaRoute.inline` / `MediaRoute.queued` / `MediaRoute.stream` compose one protocol kind with endpoint/auth and tag the route with its `kind`; `ImageModel`/`VideoModel`/`SpeechModel`/`TranscriptionModel` share the `MediaModel` base (`src/media-model.ts`).

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

Foundation + Image ship together as the reference implementation, serially. Video, Speech, and Transcription then proceed in parallel on separate branches. Image jobs and partial streaming come last, after Video has hardened `Generation`.

## Phasing

1. **Foundation** — per-modality selectors, `Media`, `Generation`, `Poll`, `Usage` union, `MediaProtocol` kinds, `@opencode/ai/promise` with `llm` + `image`. Port the five existing image protocols onto it. Unify `MediaPart` and add the `media` LLM event (fixes Gemini image output being dropped).
2. **Video** — ✅ Veo, xAI, fal, Runway shipped (`MediaProtocol.queued`, `Video.start/generate/resume/stream`, promise `ai.video`). Deferred: `Video.complete` (webhooks), Luma, Kling, MiniMax, Replicate.
3. **Speech + Transcription** — ✅ Speech: OpenAI, Gemini TTS, ElevenLabs, Cartesia, Deepgram shipped (`MediaProtocol.stream`, `Speech.generate/stream`, promise `ai.speech`). ✅ Transcription: OpenAI, Gemini, Deepgram, AssemblyAI shipped across all three route kinds (`Transcription.generate/stream/start/resume`, promise `ai.transcription`). Pending: ElevenLabs Scribe. Deferred: `Speech.session` and `Transcription.session` (WebSocket streaming).
4. **Image queued routes and partials** — BFL, fal, Replicate, Stability; OpenAI `partial_images` streaming.
5. **Later** — ElevenLabs music/SFX, Lyria, `Speech.session` / `Transcription.session`, realtime.

Core adoption (session attachments beyond png/jpeg/gif/webp/pdf, image-generation tool, TUI rendering) comes after phase 1 and is a Core concern.

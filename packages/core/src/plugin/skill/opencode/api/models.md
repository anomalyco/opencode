# Models, Providers & Generation

List models, providers, usage limits, and invoke text, image, video, decision, or voice generation endpoints.

## `GET /api/model`
List models. Retrieve the current snapshot of available models of the requested types, chat by default, ordered by release date within each type. The snapshot may precede initial plugin settlement.
- Query: `types?: Model.Type | Model.Type[]`
- Returns: 200 `{ location: Location.PublicRef; data: Model.Info[] }`

## `GET /api/model/default`
Get default model. Retrieve the model used when a session has no explicit model selection.
- Returns: 200 `{ location: Location.PublicRef; data: Model.Info | null }`

## `POST /api/experimental/generate/text`
Generate text. Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.
- Body: `{ prompt: string; model?: Model.Ref | null }`
- Returns: 200 `GenerateTextResponse`

## `POST /api/experimental/generate`
Generate text (deprecated path). Deprecated alias of POST /api/experimental/generate/text.
- Body: `{ prompt: string; model?: Model.Ref | null }`
- Returns: 200 `GenerateTextResponse`

## `POST /api/experimental/generate/image`
Generate images. Generate or edit images with an image model using the server's base configuration and return them as base64. Stateless: nothing is stored.
- Body: `Generate.ImageRequest`
- Returns: 200 `GenerateImageResponse`

## `POST /api/experimental/generate/video`
Create a video generation. Submit a video job to a video model using the server's base configuration and return its ID once the provider accepted it. The server polls the job and stores the finished videos as blobs; read the job with GET /api/experimental/generate/video/:id and the video with GET /api/experimental/blob/:id. Behind the video_generate flag. Experimental: may change without compatibility guarantees.
- Body: `Generate.VideoRequest`
- Returns: 200 `GenerateVideoCreateResponse`

## `GET /api/experimental/generate/video/{id}`
Read a video generation. Read a video job: running, completed with its videos' blobs, or error with a reason. Jobs survive a server restart, which resumes polling running ones. A job is not found 24 hours after it finished, or once none of its blobs remain. Behind the video_generate flag. Experimental: may change without compatibility guarantees.
- Returns: 200 `GenerateVideoGetResponse`

## `POST /api/experimental/generate/decisions`
Generate decisions. Ask a decision model typed predicate, choice and score questions about the input and return one probability-bearing answer per question, in question order. Stateless: nothing is stored.
- Body: `Generate.DecisionRequest`
- Returns: 200 `GenerateDecisionsResponse`

## `GET /api/experimental/voice/models`
List voice models. List supported voice models, their transports, and whether the server has a usable API key for each provider.
- Returns: 200 `VoiceModelsResponse`

## `POST /api/experimental/voice/session`
Create voice session. Create a server-brokered voice session using the server's configured provider credentials and return the WebRTC SDP answer or WebSocket ephemeral token.
- Body: `{ model: string; session?: Record<string, unknown> | null; transport: VoiceTransportInput }`
- Returns: 200 `VoiceSessionResponse`

## `GET /api/provider`
List providers. Retrieve active AI providers so clients can show provider availability and configuration.
- Returns: 200 `{ location: Location.PublicRef; data: Provider.Info[] }`

## `GET /api/provider/{providerID}`
Get provider. Retrieve a single AI provider so clients can inspect its availability and endpoint settings.
- Returns: 200 `{ location: Location.PublicRef; data: Provider.Info }`

## `GET /api/experimental/usage/limits`
Get usage limits. Return the OpenCode Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to, or null when it isn't signed in.
- Returns: 200 `{ location: Location.PublicRef; data: UsageLimits.Info | null }`

## Types

- `Generate.DecisionRequest`: `{ model: Model.Ref; input: Generate.DecisionPart[]; questions: Generate.DecisionQuestion[] }`
- `Generate.ImageRequest`: `{ model: Model.Ref; prompt: string; images?: Generate.File[]; n?: number; aspect?: string; resolution?: Generate.ImageResolution }`
- `Generate.VideoRequest`: `{ model: Model.Ref; prompt: string; start?: Generate.ImageFile; end?: Generate.ImageFile; references?: Generate.File[]; duration?: number; aspect?: Generate.VideoAspect; resolution?: Generate.VideoResolution; sound?: boolean }`
- `GenerateDecisionsResponse`: `{ data: Generate.DecisionResult }`
- `GenerateImageResponse`: `{ data: Generate.ImageResult }`
- `GenerateTextResponse`: `{ data: { text } }`
- `GenerateVideoCreateResponse`: `{ data: Generate.VideoRunning }`
- `GenerateVideoGetResponse`: `{ data: Generate.VideoJob }`
- `Location.PublicRef`: `{ directory: string }`
- `Model.Info`: `{ id: string; modelID: string; providerID: string; canonical?: string; type?: Model.Type; family?: string; name: string; compatibility?: Model.Compatibility; package?: string; settings?: Model.Settings; headers?: Record<string, string>; body?: Record<string, unknown>; capabilities: Model.Capabilities; variants: Model.Variant[]; time: { released }; cost: Model.Cost[]; status: "alpha" | "beta" | "deprecated" | "active"; enabled: boolean; limit: { context, input, output } }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
- `Model.Type`: `"chat" | "decision" | "image" | "video" | string`
- `Provider.Info`: `{ id: string; canonical?: string; integrationID?: string; name: string; activation: "auto" | "enabled" | "disabled"; package: string; compatibility?: Provider.Compatibility; settings?: Provider.Settings; headers?: Record<string, string>; body?: Record<string, unknown> }`
- `UsageLimits.Info`: `{ workspace: { id, name, usageURL }; go?: UsageLimits.Go; budgets: UsageLimits.Budget[] }`
- `VoiceModelsResponse`: `{ data: { models, default } }`
- `VoiceSessionResponse`: `{ data: { transport } }`
- `VoiceTransportInput`: `VoiceWebRTCTransportInput | VoiceWebSocketTransportInput`

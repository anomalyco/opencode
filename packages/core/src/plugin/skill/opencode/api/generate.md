# generate

## POST /api/experimental/generate/text (experimental)

Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.

Body:
- `prompt: string`
- `model?: Model.Ref`

Returns: `GenerateTextResponse`

## POST /api/experimental/generate (experimental)

Deprecated alias of POST /api/experimental/generate/text.

Body:
- `prompt: string`
- `model?: Model.Ref`

Returns: `GenerateTextResponse`

## POST /api/experimental/generate/image (experimental)

Generate or edit images with an image model using the server's base configuration and return them as base64. Stateless: nothing is stored.

Body:
- `model: Model.Ref`
- `prompt: string`
- `images?: Generate.File[]`
- `n?: number`
- `aspect?: string`
- `resolution?: Generate.ImageResolution`

Returns: `GenerateImageResponse`

## POST /api/experimental/generate/video (experimental)

Submit a video job to a video model using the server's base configuration and return its ID once the provider accepted it. The server polls the job and stores the finished videos as blobs; read the job with GET /api/experimental/generate/video/:id and the video with GET /api/experimental/blob/:id.

Body:
- `model: Model.Ref`
- `prompt: string`
- `start?: Generate.ImageFile`
- `end?: Generate.ImageFile`
- `references?: Generate.File[]`
- `duration?: number`
- `aspect?: Generate.VideoAspect`
- `resolution?: Generate.VideoResolution`
- `sound?: boolean`

Returns: `GenerateVideoCreateResponse`

## GET /api/experimental/generate/video/{id} (experimental)

Read a video job: running, completed with its videos' blobs, or error with a reason. Jobs survive a server restart, which resumes polling running ones. A job is not found 24 hours after it finished, or once none of its blobs remain.

Returns: `GenerateVideoGetResponse`

## POST /api/experimental/generate/decisions (experimental)

Ask a decision model typed predicate, choice and score questions about the input and return one probability-bearing answer per question, in question order. Stateless: nothing is stored.

Body:
- `model: Model.Ref`
- `input: Generate.DecisionPart[]` The evidence every question is asked about, in order
- `questions: Generate.DecisionQuestion[]` Question names must be unique; duplicates fail with InvalidRequestError

Returns: `GenerateDecisionsResponse`

## Types

- `Blob.Info`: `{ id: string; mime: string; bytes: number }`
- `Generate.ChoiceAnswer`: `{ type: "choice"; name: string; choice: Generate.ChoiceValue; probabilities: { value, probability }[]; confidence: number }`
- `Generate.ChoiceQuestion`: `{ type: "choice"; name: string; instructions: string; choices: { value, description }[] }`
- `Generate.ChoiceValue`: `string | boolean`
- `Generate.DecisionAnswer`: `Generate.PredicateAnswer | Generate.ChoiceAnswer | Generate.ScoreAnswer | Generate.ErrorAnswer`
- `Generate.DecisionFilePart`: `{ type: "file"; data: string; mime: string; name?: string }`
- `Generate.DecisionJsonPart`: `{ type: "json"; value: unknown }`
- `Generate.DecisionPart`: `Generate.DecisionTextPart | Generate.DecisionJsonPart | Generate.DecisionFilePart`
- `Generate.DecisionQuestion`: `Generate.PredicateQuestion | Generate.ChoiceQuestion | Generate.ScoreQuestion`
- `Generate.DecisionResult`: `{ answers: Generate.DecisionAnswer[]; cost?: number; tokens?: Generate.Usage; native?: Record<string, unknown> }`
- `Generate.DecisionTextPart`: `{ type: "text"; text: string }`
- `Generate.ErrorAnswer`: `{ type: "error"; name: string; reason: string; message?: string }`
- `Generate.File`: `{ data: string; mime: string; name?: string }`
- `Generate.ImageFile`: `{ data: string; mime: string; name?: string }`
- `Generate.ImageOutput`: `{ type: "image"; data: string; mime: string; name?: string }`
- `Generate.ImageResolution`: `"1K" | "2K" | "4K" | string`
- `Generate.ImageResult`: `{ images: Generate.ImageOutput[]; cost?: number; tokens?: Generate.Usage; native?: Record<string, unknown> }`
- `Generate.PredicateAnswer`: `{ type: "predicate"; name: string; probability: number }`
- `Generate.PredicateQuestion`: `{ type: "predicate"; name: string; instructions: string; criteria?: { true, false } }`
- `Generate.ScoreAnswer`: `{ type: "score"; name: string; score: number; probabilities: { value, label, probability }[]; confidence: number }`
- `Generate.ScoreQuestion`: `{ type: "score"; name: string; instructions: string; levels: { label, description }[] }`
- `Generate.Usage`: `{ input?: number; output?: number }`
- `Generate.VideoAspect`: `string | "auto"`
- `Generate.VideoCompleted`: `{ id: string; status: "completed"; blobs: Blob.Info[] }`
- `Generate.VideoError`: `{ id: string; status: "error"; error: string; reason: "failed" | "cancelled" | "expired" | "unknown" }`
- `Generate.VideoJob`: `Generate.VideoRunning | Generate.VideoCompleted | Generate.VideoError`
- `Generate.VideoResolution`: `"480p" | "720p" | "1080p" | "4k" | string`
- `Generate.VideoRunning`: `{ id: string; status: "running" }`
- `GenerateDecisionsResponse`: `{ data: Generate.DecisionResult }`
- `GenerateImageResponse`: `{ data: Generate.ImageResult }`
- `GenerateTextResponse`: `{ data: { text } }`
- `GenerateVideoCreateResponse`: `{ data: Generate.VideoRunning }`
- `GenerateVideoGetResponse`: `{ data: Generate.VideoJob }`
- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`

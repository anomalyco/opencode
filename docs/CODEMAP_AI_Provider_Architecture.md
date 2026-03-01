# CODEMAP CAPTURE: AI Provider Architecture — Unified Adapter Pattern with Format Transformation

> **Source**: Codemap ID `AI_Provider_Architecture__Unified_Adapter_Pattern_with_Format_Transformation_20260301_093948`
> **Captured by**: Designer (Aegis), requested by Nexus
> **Date**: 2026-03-01
> **Status**: FRAGILE — program glitch prevented directory save; this is the manual preservation copy

---

## Overview

This codemap traces the complete flow from client API requests through provider selection, format transformation, and response handling across four AI providers: **Anthropic**, **OpenAI**, **Google**, and **OA-Compatible**.

### Notable Convergence Points

| Point | Description |
|-------|-------------|
| **2e** | Provider helper assignment based on format |
| **3c** | Google format falls through to OA-Compatible parser |
| **7b** | Google's unique reliance on OA-Compatible transformations |

---

## Trace 1: API Request Entry Points → Handler Invocation

Client-facing endpoints receive requests in different formats and route to the unified handler.

```
API Request Entry Points → Handler Invocation
├── Client-Facing Endpoints (routes/zen/v1/)
│   ├── POST /v1/messages ← messages.ts:4
│   │   └── handler(input, format: "anthropic") ← [1a]
│   ├── POST /v1/responses ← responses.ts:4
│   │   └── handler(input, format: "openai") ← [1b]
│   └── POST /v1/chat/completions ← completions.ts:4
│       └── handler(input, format: "oa-compat") ← [1c]
└── Unified Handler (routes/zen/util/handler.ts) ← handler.ts:57
    ├── Parse request (url, body, headers) ← handler.ts:82
    ├── ZenData.list(modelList) ← [1d]
    │   └── Load provider configs from KV ← model.ts:86
    ├── validateModel() ← handler.ts:98
    ├── authenticate() ← handler.ts:106
    └── selectProvider() ← handler.ts:111
        └── Assign provider helper based on format ← handler.ts:448
```

### Location Index — Trace 1

| ID | Title | Path:Line |
|----|-------|-----------|
| **1a** | Anthropic Format Endpoint | `packages/console/app/src/routes/zen/v1/messages.ts:5` |
| **1b** | OpenAI Format Endpoint | `packages/console/app/src/routes/zen/v1/responses.ts:5` |
| **1c** | OA-Compatible Format Endpoint | `packages/console/app/src/routes/zen/v1/chat/completions.ts:5` |
| **1d** | Load Provider Configurations | `packages/console/app/src/routes/zen/util/handler.ts:97` |

### Source Snapshots — Trace 1

**[1a] messages.ts:4-7** — Anthropic endpoint:
```typescript
export function POST(input: APIEvent) {
  return handler(input, {
    format: "anthropic",
    modelList: "full",
```

**[1b] responses.ts:4-7** — OpenAI endpoint:
```typescript
export function POST(input: APIEvent) {
  return handler(input, {
    format: "openai",
    modelList: "full",
```

**[1c] completions.ts:4-7** — OA-Compatible endpoint:
```typescript
export function POST(input: APIEvent) {
  return handler(input, {
    format: "oa-compat",
    modelList: "full",
```

---

## Trace 2: Provider Selection Logic with Load Balancing

Core routing logic determining which provider to use based on BYOK credentials, trial status, sticky sessions, or hash-based load balancing.

```
Handler Request Flow
└── handler() main function ← handler.ts:57
    ├── ZenData.list() loads configs ← [1d]
    ├── authenticate() gets user data ← handler.ts:458
    └── retriableRequest() async closure ← handler.ts:110
        └── selectProvider() invocation ← [2a]
            ├── Check BYOK credentials ← [2b]
            │   └── return modelInfo.byokProvider ← handler.ts:407
            ├── Check trial status ← [2c]
            │   └── return trial provider ← handler.ts:411
            ├── Check sticky provider ← handler.ts:414
            │   └── return cached provider ← handler.ts:416
            ├── Hash-based load balancing ← [2d]
            │   ├── Filter by weight & excludes ← handler.ts:420
            │   ├── Hash session ID (last 4 chars) ← handler.ts:428
            │   └── Select from weighted pool ← handler.ts:432
            ├── Fallback provider selection ← handler.ts:437
            │   └── return fallbackProvider ← handler.ts:437
            └── Assign helper by format ← [2e]
                ├── Get provider format ← [2f]
                ├── if "anthropic" → anthropicHelper ← handler.ts:450
                ├── if "google" → googleHelper ← [2f]
                ├── if "openai" → openaiHelper ← handler.ts:452
                └── else → oaCompatHelper ← handler.ts:453
```

### Location Index — Trace 2

| ID | Title | Path:Line |
|----|-------|-----------|
| **2a** | Invoke Provider Selection | `handler.ts:111` |
| **2b** | Check BYOK Credentials | `handler.ts:406` |
| **2c** | Check Trial Status | `handler.ts:410` |
| **2d** | Hash-Based Load Balancing | `handler.ts:425` |
| **2e** | Assign Provider Helper | `handler.ts:448` |
| **2f** | Google Helper Assignment | `handler.ts:451` |

### Source Snapshot — Trace 2 (selectProvider helper assignment)

**handler.ts:444-454**:
```typescript
return {
  ...modelProvider,
  ...zenData.providers[modelProvider.id],
  ...(() => {
    const format = zenData.providers[modelProvider.id].format
    const providerModel = modelProvider.model
    if (format === "anthropic") return anthropicHelper({ reqModel, providerModel })
    if (format === "google") return googleHelper({ reqModel, providerModel })
    if (format === "openai") return openaiHelper({ reqModel, providerModel })
    return oaCompatHelper({ reqModel, providerModel })
  })(),
}
```

---

## Trace 3: Request Body Transformation — Client Format → Provider Format

Converter system transforming request bodies between API formats using a common intermediate representation.

```
Request Body Transformation Flow
├── Handler invokes body converter ← [3a]
│   └── createBodyConverter(opts.format,
│       providerInfo.format) ← handler.ts:130
│
└── createBodyConverter() function ← provider.ts:165
    ├── Step 1: Parse client format to Common
    │   ├── if from === "anthropic" ← [3b]
    │   │   └── fromAnthropicRequest() ← provider.ts:170
    │   ├── else if from === "openai" ← provider.ts:171
    │   │   └── fromOpenaiRequest() ← provider.ts:171
    │   └── else (Google fallthrough) ← [3c]
    │       └── fromOaCompatibleRequest() ← [3e]
    │
    └── Step 2: Convert Common to provider
        ├── if to === "anthropic" ← [3d]
        │   └── toAnthropicRequest() ← provider.ts:174
        ├── if to === "openai" ← provider.ts:175
        │   └── toOpenaiRequest() ← provider.ts:175
        └── if to === "oa-compat" ← provider.ts:176
            └── toOaCompatibleRequest() ← provider.ts:176
```

### Location Index — Trace 3

| ID | Title | Path:Line |
|----|-------|-----------|
| **3a** | Invoke Body Converter | `handler.ts:130` |
| **3b** | Parse Source Format | `provider.ts:170` |
| **3c** | Google Fallthrough to OA-Compatible | `provider.ts:172` |
| **3d** | Convert to Target Format | `provider.ts:174` |
| **3e** | OA-Compatible Request Parser | `openai-compatible.ts:76` |

### Source Snapshot — Trace 3

**provider.ts:165-177** — The converter hub:
```typescript
export function createBodyConverter(from: ZenData.Format, to: ZenData.Format) {
  return (body: any): any => {
    if (from === to) return body

    let raw: CommonRequest
    if (from === "anthropic") raw = fromAnthropicRequest(body)
    else if (from === "openai") raw = fromOpenaiRequest(body)
    else raw = fromOaCompatibleRequest(body)

    if (to === "anthropic") return toAnthropicRequest(raw)
    if (to === "openai") return toOpenaiRequest(raw)
    if (to === "oa-compat") return toOaCompatibleRequest(raw)
  }
}
```

---

## Trace 4: HTTP Request Construction and Provider Communication

Provider-specific URL, header, and body modifications before the actual HTTP request.

```
HTTP Request Construction Flow
├── Main Handler Request Loop
│   ├── Construct provider URL ← [4a]
│   │   └── Call providerInfo.modifyUrl() ← handler.ts:126
│   │       └── Google URL builder ← [4b]
│   │           (builds /models/{model}:streamGenerateContent)
│   ├── Build request headers
│   │   ├── Call providerInfo.modifyHeaders() ← [4c]
│   │   │   └── Google header setup ← [4d]
│   │   │       (sets x-goog-api-key)
│   │   ├── Apply headerMappings ← handler.ts:144
│   │   └── Apply extra headers ← handler.ts:147
│   ├── Build request body
│   │   └── Call providerInfo.modifyBody() ← handler.ts:128
│   │       (Google: pass-through)
│   └── Execute HTTP POST ← [4e]
│       └── fetchWith429Retry() ← handler.ts:753
│           (retry logic for rate limits)
└── Provider Helper Functions
    ├── modifyUrl() - endpoint construction ← provider.ts:38
    ├── modifyHeaders() - auth headers ← provider.ts:39
    └── modifyBody() - payload modifications ← provider.ts:40
```

### Location Index — Trace 4

| ID | Title | Path:Line |
|----|-------|-----------|
| **4a** | Construct Provider URL | `handler.ts:126` |
| **4b** | Google URL Construction | `google.ts:31` |
| **4c** | Set Provider Headers | `handler.ts:143` |
| **4d** | Google Header Setup | `google.ts:34` |
| **4e** | Execute HTTP Request | `handler.ts:139` |

### Provider URL Patterns

| Provider | Pattern |
|----------|---------|
| **Anthropic** | `{api}/messages` or `{api}/model/{model}/invoke-with-response-stream` (Bedrock) |
| **Google** | `{api}/models/{model}:streamGenerateContent?alt=sse` or `:generateContent` |
| **OpenAI** | `{api}/responses` |
| **OA-Compat** | `{api}/chat/completions` |

### Provider Header Patterns

| Provider | Auth Header |
|----------|------------|
| **Anthropic** | `x-api-key` + `anthropic-version` + optional `anthropic-beta` |
| **Google** | `x-goog-api-key` |
| **OpenAI** | `authorization: Bearer` |
| **OA-Compat** | `authorization: Bearer` + `x-session-affinity` |

---

## Trace 5: Non-Streaming Response — Provider Format → Client Format

Response transformation and cost calculation for non-streaming responses.

```
Non-Streaming Response Flow
├── Handler receives provider response
│   └── res.json() parse ← [5a]
├── Usage normalization branch
│   ├── providerInfo.normalizeUsage() ← [5b]
│   │   └── Google: normalizeUsage() impl ← [5c]
│   └── calculateCost() ← [5f]
└── Response transformation branch
    ├── createResponseConverter() ← [5d]
    │   └── Converter logic ← provider.ts:199
    │       ├── from provider format
    │       │   └── fromOaCompatibleResponse() ← [5e]
    │       └── to client format ← provider.ts:207
    │           └── toAnthropicResponse() / etc.
    └── JSON.stringify(converted response) ← handler.ts:220
```

### Location Index — Trace 5

| ID | Title | Path:Line |
|----|-------|-----------|
| **5a** | Parse Provider Response | `handler.ts:211` |
| **5b** | Normalize Usage Data | `handler.ts:212` |
| **5c** | Google Usage Normalization | `google.ts:62` |
| **5d** | Create Response Converter | `handler.ts:219` |
| **5e** | Google Response Conversion | `provider.ts:205` |
| **5f** | Calculate Usage Cost | `handler.ts:213` |

---

## Trace 6: Streaming Response Processing with Usage Parsing

Real-time stream handling with provider-specific chunk parsing, binary decoding (Bedrock), and usage extraction.

```
Streaming Response Handler (handler.ts) ← handler.ts:237
├── Create stream converters ← [6a]
├── Create binary decoder (Bedrock only) ← [6b]
├── Create usage parser ← handler.ts:239
└── ReadableStream.start() ← handler.ts:241
    └── pump() loop ← handler.ts:250
        ├── reader.read() chunks ← handler.ts:252
        ├── binaryDecoder?.(rawValue) ← handler.ts:282
        ├── buffer += decode(value) ← handler.ts:286
        ├── Split by streamSeparator ← [6c]
        └── for each part ← handler.ts:292
            ├── usageParser.parse(part) ← [6d]
            │   └── Google: parse 'data:' lines ← [6e]
            ├── if (responseModifier) ← handler.ts:298
            │   └── string.replace(k, v) ← handler.ts:300
            └── else if (format !== opts.format) ← handler.ts:303
                └── streamConverter(part) ← [6f]
                    └── fromOaCompatibleChunk() ← [6g]
```

### Location Index — Trace 6

| ID | Title | Path:Line |
|----|-------|-----------|
| **6a** | Create Stream Converter | `handler.ts:238` |
| **6b** | Binary Stream Decoder | `handler.ts:240` |
| **6c** | Split Stream by Separator | `handler.ts:289` |
| **6d** | Parse Usage from Chunks | `handler.ts:296` |
| **6e** | Google Usage Parser | `google.ts:45` |
| **6f** | Convert Stream Chunk | `handler.ts:304` |
| **6g** | Google Chunk Conversion | `provider.ts:187` |

### Stream Separators

| Provider | Separator |
|----------|-----------|
| **Anthropic** | `\n\n` |
| **Google** | `\r\n\r\n` |
| **OpenAI** | `\n\n` |
| **OA-Compat** | `\n\n` |

---

## Trace 7: Google's Unique Architecture — Helper + OA-Compatible Transformations

Google combines its own helper functions for provider-specific operations while relying on OA-Compatible transformation functions.

```
Google Provider Architecture
├── googleHelper() returns config object ← google.ts:29
│   └── format: "google" ← [7a]
│
├── Request Transformation Flow
│   └── createBodyConverter(from, to) ← provider.ts:165
│       ├── if (from === "anthropic") → parse ← provider.ts:170
│       ├── else if (from === "openai") → parse ← provider.ts:171
│       └── else → fromOaCompatibleRequest() ← [7b]
│
├── Google-Specific Helper Functions
│   ├── modifyUrl() → builds endpoint ← google.ts:31
│   ├── modifyHeaders() → x-goog-api-key ← google.ts:33
│   ├── modifyBody() → pass-through ← [7c]
│   ├── streamSeparator: "\r\n\r\n" ← [7d]
│   ├── createUsageParser() → metadata ← google.ts:41
│   └── normalizeUsage() ← google.ts:62
│       └── subtract cache tokens ← [7e]
│
└── Response/Chunk Transformation
    ├── fromOaCompatibleResponse() ← openai-compatible.ts:216
    └── fromOaCompatibleChunk() ← openai-compatible.ts:396
```

### Location Index — Trace 7

| ID | Title | Path:Line |
|----|-------|-----------|
| **7a** | Google Format Declaration | `google.ts:30` |
| **7b** | Fallthrough Logic | `provider.ts:172` |
| **7c** | Google Body Modifier | `google.ts:36` |
| **7d** | Google Stream Separator | `google.ts:40` |
| **7e** | Google Cache Token Handling | `google.ts:68` |

### Source Snapshot — google.ts (complete helper)

```typescript
export const googleHelper: ProviderHelper = ({ providerModel }) => ({
  format: "google",
  modifyUrl: (providerApi: string, isStream?: boolean) =>
    `${providerApi}/models/${providerModel}:${isStream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
  modifyHeaders: (headers: Headers, body: Record<string, any>, apiKey: string) => {
    headers.set("x-goog-api-key", apiKey)
  },
  modifyBody: (body: Record<string, any>) => {
    return body
  },
  createBinaryStreamDecoder: () => undefined,
  streamSeparator: "\r\n\r\n",
  createUsageParser: () => {
    let usage: Usage
    return {
      parse: (chunk: string) => {
        if (!chunk.startsWith("data: ")) return
        let json
        try { json = JSON.parse(chunk.slice(6)) as { usageMetadata?: Usage } }
        catch (e) { return }
        if (!json.usageMetadata) return
        usage = json.usageMetadata
      },
      retrieve: () => usage,
      buidlCostChunk: (cost: string) => `data: ${JSON.stringify({ type: "ping", cost })}\n\n`,
    }
  },
  normalizeUsage: (usage: Usage) => {
    const inputTokens = usage.promptTokenCount ?? 0
    const outputTokens = usage.candidatesTokenCount ?? 0
    const reasoningTokens = usage.thoughtsTokenCount ?? 0
    const cacheReadTokens = usage.cachedContentTokenCount ?? 0
    return {
      inputTokens: inputTokens - cacheReadTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWrite5mTokens: undefined,
      cacheWrite1hTokens: undefined,
    }
  },
})
```

---

## Trace 8: Provider Configuration Loading from Cloudflare KV

Static provider configurations loaded from 30 KV resources at runtime.

```
Provider Configuration Loading Flow
├── ZenData.list() invoked from handler ← handler.ts:97
│   ├── Concatenate 30 KV resources ← [8a]
│   │   ├── Resource.ZEN_MODELS1.value ← model.ts:87
│   │   ├── Resource.ZEN_MODELS2.value ← model.ts:88
│   │   └── ... through Resource.ZEN_MODELS30.value ← model.ts:116
│   ├── Parse JSON with ModelsSchema ← [8b]
│   │   ├── models: record of ModelSchema ← model.ts:75
│   │   ├── liteModels: record of ModelSchema ← model.ts:76
│   │   ├── providers: record of ProviderSchema ← model.ts:77
│   │   │   └── format field (optional) ← [8c]
│   │   └── providerFamilies: record ← model.ts:78
│   └── Return { models, providers } ← model.ts:119
└── selectProvider() uses loaded config ← handler.ts:395
    └── Merge static config with helpers ← [8d]
        ├── ...zenData.providers[id] ← handler.ts:446
        │   ├── api, apiKey, format ← model.ts:61
        │   ├── headerMappings (optional) ← model.ts:64
        │   └── payloadModifier (optional) ← model.ts:65
        └── ...helper functions ← handler.ts:447
            └── modifyUrl, modifyHeaders, etc.
```

### Location Index — Trace 8

| ID | Title | Path:Line |
|----|-------|-----------|
| **8a** | Concatenate KV Resources | `model.ts:86` |
| **8b** | Parse Provider Schema | `model.ts:118` |
| **8c** | Provider Format Field | `model.ts:63` |
| **8d** | Merge Provider Config | `handler.ts:446` |

### Source Snapshot — ProviderSchema

```typescript
const ProviderSchema = z.object({
  api: z.string(),
  apiKey: z.string(),
  format: FormatSchema.optional(),
  headerMappings: z.record(z.string(), z.string()).optional(),
  payloadModifier: z.record(z.string(), z.any()).optional(),
  family: z.string().optional(),
})
```

---

## Trace 9: Authentication and BYOK Provider Credentials

Database-backed authentication flow that retrieves user credentials and BYOK provider settings from MySQL.

```
Authentication & BYOK Provider Flow
├── Main Handler Entry
│   └── authenticate(modelInfo) ← [9a]
│       └── Database Query ← handler.ts:465
│           ├── JOIN KeyTable (API key validation) ← handler.ts:510
│           ├── JOIN BillingTable (billing info) ← handler.ts:511
│           ├── JOIN UserTable (user limits) ← handler.ts:512
│           └── LEFT JOIN ProviderTable ← [9b]
│               └── SELECT credentials field ← [9d]
│                   └── credentials column ← [9c]
│                       (stores BYOK API keys)
└── Provider Selection Flow
    └── selectProvider() ← handler.ts:395
        └── Check authInfo.provider.credentials ← handler.ts:406
            └── updateProviderKey() ← handler.ts:122
                └── Override API key ← [9e]
                    (replaces default with user's key)
```

### Location Index — Trace 9

| ID | Title | Path:Line |
|----|-------|-----------|
| **9a** | Invoke Authentication | `handler.ts:106` |
| **9b** | Join Provider Table | `handler.ts:515` |
| **9c** | Provider Credentials Column | `provider.sql.ts:11` |
| **9d** | Select Provider Credentials | `handler.ts:505` |
| **9e** | Override with BYOK Key | `handler.ts:750` |

### Source Snapshot — ProviderTable schema

```typescript
export const ProviderTable = mysqlTable(
  "provider",
  {
    ...workspaceColumns,
    ...timestamps,
    provider: varchar("provider", { length: 64 }).notNull(),
    credentials: text("credentials").notNull(),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("workspace_provider").on(table.workspaceID, table.provider)],
)
```

---

## Key Interfaces (Common Intermediate Types)

### ProviderHelper — provider.ts:36-49

```typescript
export type ProviderHelper = (input: { reqModel: string; providerModel: string }) => {
  format: ZenData.Format
  modifyUrl: (providerApi: string, isStream?: boolean) => string
  modifyHeaders: (headers: Headers, body: Record<string, any>, apiKey: string) => void
  modifyBody: (body: Record<string, any>, workspaceID?: string) => Record<string, any>
  createBinaryStreamDecoder: () => ((chunk: Uint8Array) => Uint8Array | undefined) | undefined
  streamSeparator: string
  createUsageParser: () => {
    parse: (chunk: string) => void
    retrieve: () => any
    buidlCostChunk: (cost: string) => string
  }
  normalizeUsage: (usage: any) => UsageInfo
}
```

### UsageInfo — provider.ts:27-34

```typescript
export type UsageInfo = {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
}
```

### CommonRequest — provider.ts:101-111

```typescript
export interface CommonRequest {
  model: string
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  messages: CommonMessage[]
  stream?: boolean
  tools?: CommonTool[]
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } }
}
```

### CommonResponse — provider.ts:113-133

```typescript
export interface CommonResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: "assistant"
      content?: string
      tool_calls?: CommonToolCall[]
    }
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
  }>
  usage?: { ... }
}
```

### CommonChunk — provider.ts:135-163

```typescript
export interface CommonChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: "assistant"
      content?: string
      tool_calls?: Array<{ index: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }>
    }
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
  }>
  usage?: { ... }
}
```

---

## File Inventory

All paths relative to `packages/console/app/src/routes/zen/`:

| File | Purpose | Lines |
|------|---------|-------|
| `v1/messages.ts` | Anthropic endpoint | 13 |
| `v1/responses.ts` | OpenAI endpoint | 13 |
| `v1/chat/completions.ts` | OA-Compat endpoint | 13 |
| `util/handler.ts` | Unified handler, selection, auth, billing, streaming | 1021 |
| `util/provider/provider.ts` | Interfaces, converter hub | 212 |
| `util/provider/anthropic.ts` | Anthropic helper + from/to transforms | 754 |
| `util/provider/openai.ts` | OpenAI helper + from/to transforms | 633 |
| `util/provider/openai-compatible.ts` | OA-Compat helper + from/to transforms | 549 |
| `util/provider/google.ts` | Google helper (NO from/to — uses OA-Compat fallthrough) | 77 |

Core module:
| `packages/console/core/src/model.ts` | ZenData, KV loading, schemas | 184 |
| `packages/console/core/src/schema/provider.sql.ts` | ProviderTable (BYOK credentials) | 15 |

---

## Architecture Diagram Summary

```
                    ┌─────────────────────────────────────────────┐
                    │           Client API Requests                │
                    │  /v1/messages  /v1/responses  /v1/chat/comp  │
                    │   (anthropic)    (openai)      (oa-compat)   │
                    └──────────┬──────────┬──────────┬────────────┘
                               │          │          │
                               ▼          ▼          ▼
                    ┌─────────────────────────────────────────────┐
                    │           Unified Handler (handler.ts)       │
                    │  ┌──────────────────────────────────────┐   │
                    │  │ ZenData.list() → KV configs (30 res) │   │
                    │  │ authenticate() → MySQL + BYOK         │   │
                    │  │ selectProvider() → routing logic       │   │
                    │  └──────────────────────────────────────┘   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │         Provider Helper Assignment           │
                    │  format → anthropicHelper | googleHelper     │
                    │           openaiHelper    | oaCompatHelper   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │      Format Transformation (provider.ts)    │
                    │  from* → CommonRequest/Response/Chunk → to* │
                    │  (Google falls through to OA-Compat)        │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │         HTTP Request + Streaming             │
                    │  fetchWith429Retry → ReadableStream pump     │
                    │  Usage parsing → Cost calculation → Billing  │
                    └─────────────────────────────────────────────┘
```

---

> **END OF CODEMAP CAPTURE**
> This document is a faithful reproduction of all 9 traces, 45 location IDs, and associated source snapshots from the codemap `AI_Provider_Architecture__Unified_Adapter_Pattern_with_Format_Transformation_20260301_093948`.

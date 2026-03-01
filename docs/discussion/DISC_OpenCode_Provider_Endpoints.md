## Common Patterns and Convergence Points

These providers all implement a **unified adapter pattern** for different AI model APIs. Here's what they have in common:

### **Shared Interface Structure**
All providers implement the [ProviderHelper](cci:2://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:35:0-48:1) interface from [provider.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:0:0-0:0) with these common methods:
- [modifyUrl()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:30:2-31:110) - Constructs endpoint URLs
- [modifyHeaders()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:32:2-34:3) - Sets authentication and provider-specific headers
- [modifyBody()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:35:2-37:3) - Transforms request bodies
- [createUsageParser()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai.ts:26:2-48:3) - Parses token usage from streaming responses
- [normalizeUsage()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:61:2-74:3) - Converts provider-specific usage to standard [UsageInfo](cci:2://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:26:0-33:1)
- [createBinaryStreamDecoder()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:38:2-38:44) - Handles binary stream decoding (optional)
- `streamSeparator` - Defines stream chunk boundaries

### **Common Variables They All Carry**

1. **Usage-related variables** (each with provider-specific naming):
   - Input tokens: `input_tokens`, `prompt_tokens`, `promptTokenCount`
   - Output tokens: `output_tokens`, `completion_tokens`, `candidatesTokenCount`
   - Cache tokens: `cached_tokens`, `cache_read_input_tokens`, `cachedContentTokenCount`
   - Reasoning tokens: `reasoning_tokens`, `thoughtsTokenCount`

2. **Request/response transformation variables**:
   - `model`, `max_tokens`, `temperature`, `top_p`, `stop`
   - `messages[]` array with `role` and `content`
   - `tools[]` and `tool_choice` for function calling
   - `stream` boolean for streaming responses

3. **Common structural elements**:
   - `id`, `object`, `created`, `choices[]` for responses
   - `finish_reason` mapping (stop/tool_calls/length/content_filter)
   - `delta` objects for streaming chunks

### **Where They Converge**

1. **In [provider.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:0:0-0:0)** - The central hub that:
   - Defines all common interfaces ([CommonRequest](cci:2://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:100:0-110:1), [CommonResponse](cci:2://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:112:0-132:1), [CommonChunk](cci:2://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:134:0-162:1))
   - Provides converter functions ([createBodyConverter](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:164:0-177:1), [createStreamPartConverter](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:179:0-195:1), [createResponseConverter](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:197:0-210:1))
   - Imports and orchestrates all provider-specific functions

2. **Through transformation functions** - Each provider has:
   - `from[Provider]Request/Response/Chunk()` - Convert from provider format to common
   - `to[Provider]Request/Response/Chunk()` - Convert from common to provider format

3. **At the usage normalization layer** - All providers convert their token usage to the standardized [UsageInfo](cci:2://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:26:0-33:1) format with fields like `inputTokens`, `outputTokens`, `cacheReadTokens`, etc.

The architecture enables **format-agnostic communication** - any provider can be converted to any other format through the common intermediate representation defined in [provider.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:0:0-0:0).

The provider information is stored and retrieved through a **multi-layered system**:

### **1. Primary Storage - Cloudflare KV Resources**
Provider configurations are stored in **Cloudflare KV storage** accessed via the `Resource` object. In [model.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/core/src/model.ts:0:0-0:0) lines 86-116, provider data is loaded from 30 separate KV resources:

```typescript
const json = JSON.parse(
  Resource.ZEN_MODELS1.value +
  Resource.ZEN_MODELS2.value +
  // ... continues through ZEN_MODELS30
)
```

### **2. Database Storage - User Provider Credentials**
User-specific provider credentials are stored in the **MySQL database** via `ProviderTable` (provider.sql.ts):
- `provider` - Provider ID (e.g., "openai", "anthropic")  
- `credentials` - API keys and auth tokens
- `workspaceID` - Workspace scoping

### **3. Runtime Retrieval Flow**

**In handler.ts lines 97-127:**
1. [ZenData.list()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/resource/resource.node.ts:50:12-62:18) loads all provider configurations from Cloudflare KV
2. [selectProvider()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:394:2-455:3) chooses the appropriate provider based on:
   - User's BYOK credentials (from database)
   - Trial status
   - Sticky provider preferences
   - Fallback providers
   - Load balancing weights

**Key retrieval points:**
- **Static config**: `zenData.providers[modelProvider.id]` (from KV)
- **User credentials**: `authInfo.provider.credentials` (from database)
- **Model mappings**: `modelInfo.providers[]` (from KV config)

### **4. Provider Helper Assignment**
In [selectProvider()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:394:2-455:3) lines 447-454, the appropriate helper is assigned based on format:
```typescript
const format = zenData.providers[modelProvider.id].format
if (format === "anthropic") return anthropicHelper({ reqModel, providerModel })
if (format === "google") return googleHelper({ reqModel, providerModel })
if (format === "openai") return openaiHelper({ reqModel, providerModel })
return oaCompatHelper({ reqModel, providerModel })
```

### **Storage Architecture Summary**
- **Static provider configs** (API endpoints, formats, headers): Cloudflare KV (30 resources)
- **User credentials** (API keys): MySQL ProviderTable
- **Runtime selection**: Handler combines static config + user credentials + routing logic
- **Provider helpers**: Code-level adapters for each API format

The system separates **infrastructure configuration** (KV) from **user authentication data** (database) for security and scalability.

## Complete Flow: All Unique Things Each Provider Does

From [selectProvider()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:394:2-455:3) through the entire request/response cycle, here are **ALL the unique operations** each provider helper performs:

### **1. Provider Selection Logic (selectProvider)**
- **BYOK credentials**: `authInfo?.provider?.credentials` → uses user's own API keys
- **Trial mode**: `isTrial` → uses trial provider
- **Sticky provider**: `stickyProvider` → session affinity
- **Load balancing**: Hash-based selection using session ID (lines 425-432)
- **Fallback**: `modelInfo.fallbackProvider` → last resort

### **2. URL Construction (modifyUrl)**
Each provider builds different endpoint patterns:
- **Anthropic**: `{providerApi}/messages` or `{providerApi}/model/{model}/invoke-with-response-stream`
- **Google**: `{providerApi}/models/{providerModel}:streamGenerateContent?alt=sse` or `:generateContent`
- **OpenAI**: `{providerApi}/responses`
- **OA-Compat**: `{providerApi}/chat/completions`

### **3. Header Modification (modifyHeaders)**
- **Anthropic**: `x-api-key` + `anthropic-version` + optional `anthropic-beta`
- **Google**: `x-goog-api-key`
- **OpenAI**: `authorization: Bearer`
- **OA-Compat**: `authorization: Bearer` + `x-session-affinity`

### **4. Body Modification (modifyBody)**
- **Anthropic**: Bedrock vs direct API differences, service_tier, cache_control
- **Google**: No modification (pass-through)
- **OpenAI**: Adds `safety_identifier` (workspaceID)
- **OA-Compat**: Adds `stream_options: { include_usage: true }`

### **5. Request Flow (Handler)**
```typescript
// URL + Body construction
const reqUrl = providerInfo.modifyUrl(providerInfo.api, isStream)
const reqBody = providerInfo.modifyBody(convertedBody, workspaceID)

// Header setup + additional mappings
providerInfo.modifyHeaders(headers, body, apiKey)
+ headerMappings (header remapping)
+ headers (extra headers)
```

### **6. Stream Processing**
Each provider handles streaming differently:

#### **Binary Decoding**
- **Anthropic**: EventStreamCodec for Bedrock binary streams
- **Google/OpenAI/OA-Compat**: No binary decoding (undefined)

#### **Stream Separators**
- **Anthropic**: `\n\n`
- **Google**: `\r\n\r\n`  
- **OpenAI/OA-Compat**: `\n\n`

#### **Usage Parsing**
- **Anthropic**: Parses `data:` lines, handles cache_creation tokens
- **Google**: Parses `data:` lines from usageMetadata
- **OpenAI**: Parses `event: response.completed` + `data:` lines
- **OA-Compat**: Parses `data:` lines from usage object

### **7. Response Transformation**
- **Format conversion**: [createStreamPartConverter()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/provider.ts:179:0-195:1) transforms between formats
- **Response modification**: `responseModifier` does string replacements
- **Usage normalization**: [normalizeUsage()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:61:2-74:3) converts to standard UsageInfo

### **8. Error Handling & Retry Logic**
- **429 retry**: [fetchWith429Retry()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:752:2-759:3) with exponential backoff
- **Failover**: Excludes failed providers, tries alternatives
- **Status codes**: Special handling for 404 (OpenAI message ID issues)

### **9. Cost Tracking**
- **Usage parsing**: Extract tokens from each provider's format
- **Cost calculation**: [calculateCost()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:761:2-808:3) with provider-specific pricing
- **Billing**: [trackUsage()](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:814:2-988:3) updates database/billing

### **10. Data Flow Summary**
```
Request → selectProvider() → Helper Functions → fetch() → Response
                ↓                    ↓              ↓
    [URL/Headers/Body]    [Binary/Stream]   [Usage/Cost]
                ↓                    ↓              ↓
        Provider Endpoint → Stream Processing → Billing/Tracking
```
Each provider doesn't just handle endpoints - they uniquely process URLs, headers, bodies, binary streams, usage parsing, cost calculation, error handling, and data transformation throughout the entire request lifecycle.

## They Are **SEPARATE** - And Google is Missing!

### **The from/to Functions Are Separate Per Provider**

Each provider has its **own separate set** of transformation functions:

- **Anthropic**: `fromAnthropicRequest/Response/Chunk` + `toAnthropicRequest/Response/Chunk`
- **OpenAI**: `fromOpenaiRequest/Response/Chunk` + `toOpenaiRequest/Response/Chunk`  
- **OpenAI-Compatible**: `fromOaCompatibleRequest/Response/Chunk` + `toOaCompatibleRequest/Response/Chunk`
- **Google**: **MISSING!** - No from/to functions exist

### **The Converter Functions Only Handle 3 Formats**

In [provider.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/opencode/src/provider/provider.ts:0:0-0:0) lines 170-177, 185-194, and 203-209, the converters only support **3 formats**:

```typescript
// createBodyConverter
if (from === "anthropic") raw = fromAnthropicRequest(body)
else if (from === "openai") raw = fromOpenaiRequest(body)
else raw = fromOaCompatibleRequest(body)  // ← Google falls here!

// createStreamPartConverter  
if (from === "anthropic") raw = fromAnthropicChunk(part)
else if (from === "openai") raw = fromOpenaiChunk(part)
else raw = fromOaCompatibleChunk(part)  // ← Google falls here!

// createResponseConverter
if (from === "anthropic") raw = fromAnthropicResponse(response)
else if (from === "openai") raw = fromOpenaiResponse(response)
else raw = fromOaCompatibleResponse(response)  // ← Google falls here!
```

### **Google's Special Case**

**Google is the odd one out** - it has **NO from/to transformation functions**. Instead:

1. **Google uses OA-Compatible transformations** as fallback (the `else` cases)
2. **Google only has the helper functions** ([googleHelper](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:28:0-75:2)) for URL/headers/usage parsing
3. **Google relies on the common format** for request/response transformations

### **Helper vs Transformation Split**

Yes, the helpers **split up again** in this direction:

- **Helper Functions** ([googleHelper](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:28:0-75:2), [anthropicHelper](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/anthropic.ts:18:0-181:1), etc.): Handle provider-specific **URL construction, headers, body modification, usage parsing**
- **Transformation Functions** (`from/to`): Handle **format conversion** between different API structures

**Google Helper**: Only does provider-specific stuff (URL, headers, usage)
**Google Transformations**: Uses OA-Compatible functions as fallback

### **Architecture Implication**

```
Request → [Helper: URL/Headers/Body] → [Transform: Format Conversion] → Provider
           ↑                        ↑
    Google-specific           Google uses OA-Compatible
```

Let me trace exactly where [fromOaCompatibleResponse](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:215:0-311:1) goes and confirm the [toOaCompatibleRequest](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:132:0-213:1) flow.



## Exactly! Here's the Complete Flow

### **Yes, We Have Both:**
- [toOaCompatibleRequest](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:132:0-213:1) - Converts TO OpenAI-Compatible format
- [fromOaCompatibleResponse](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:215:0-311:1) - Converts FROM OpenAI-Compatible format

### **Where They Go in the Flow**

#### **1. Request Direction (toOaCompatibleRequest)**
In [handler.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:0:0-0:0) line 130:
```typescript
{
  ...createBodyConverter(opts.format, providerInfo.format)(body),
  model: providerInfo.model,
  ...(providerInfo.payloadModifier ?? {}),
}
```

**For Google requests:**
- `opts.format` = client format (e.g., "anthropic")
- `providerInfo.format` = "google" 
- Since Google has no `fromGoogleRequest`, it falls through to [fromOaCompatibleRequest](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:75:0-130:1)
- Then converts TO target format with [toOaCompatibleRequest](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:132:0-213:1)

#### **2. Response Direction (fromOaCompatibleResponse)**
In [handler.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:0:0-0:0) line 219:
```typescript
const responseConverter = createResponseConverter(providerInfo.format, opts.format)
const body = JSON.stringify(
  responseConverter({
    ...json,
    cost: calculateOccuredCost(billingSource, costInfo),
  }),
)
```

**For Google responses:**
- `providerInfo.format` = "google"
- `opts.format` = client format (e.g., "anthropic")
- Since Google has no `toGoogleResponse`, it uses [fromOaCompatibleResponse](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:215:0-311:1) to convert FROM Google format
- Then converts TO client format

#### **3. Streaming Direction (fromOaCompatibleChunk/toOaCompatibleChunk)**
In [handler.ts](cci:7://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/handler.ts:0:0-0:0) line 238:
```typescript
const streamConverter = createStreamPartConverter(providerInfo.format, opts.format)
```

**For Google streaming:**
- Uses [fromOaCompatibleChunk](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:395:0-470:1) to parse Google stream chunks
- Uses [toOaCompatibleChunk](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:472:0-547:1) to convert to client format

### **The Google Flow Summary**

```
Client Request → createBodyConverter() → fromOaCompatibleRequest() → Google API
                                    ↑
                        (Google has no fromGoogleRequest)

Google Response → createResponseConverter() → fromOaCompatibleResponse() → Client
                                    ↑
                        (Google has no toGoogleResponse)

Google Stream → createStreamPartConverter() → fromOaCompatibleChunk() → Client
                                    ↑
                        (Google has no toGoogleChunk)
```

### **Why This Works**

Google's API format is **close enough to OpenAI-Compatible** that it can use the same transformation functions. The `fromOaCompatible*` functions handle the common structure, and Google's helper ([googleHelper](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/google.ts:28:0-75:2)) handles the Google-specific parts (URL construction, headers, usage parsing).

**Answer: Yes!** Google uses [toOaCompatibleRequest](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:132:0-213:1) for outgoing requests and [fromOaCompatibleResponse](cci:1://file:///c:/P4NTH30N/OP3NF1XER/opencode-dev/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:215:0-311:1) for incoming responses, with the same pattern for streaming chunks. The OpenAI-Compatible functions serve as Google's transformation layer.
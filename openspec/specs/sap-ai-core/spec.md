# sap-ai-core Specification

## Purpose

Enterprise integration for invoking SAP AI Core hosted deployments (LLM, embedding, custom inference) through the unified opencode provider interface. Enables regional hosting, tenant isolation, and alias-based model selection using existing workflow tooling without adding heavy third-party SDK dependencies.

## Requirements

### Requirement: SAP AI Core Provider Autoload

The system SHALL conditionally autoload the `sap-ai-core` provider when minimally required authentication configuration is present.

#### Scenario: Autoload via Service Key

- **WHEN** environment contains `SAP_AI_CORE_SERVICE_KEY` with valid JSON (including `url`, `clientid`, `clientsecret`, `uaa.url`)
- **THEN** provider status is loaded and models become selectable

#### Scenario: Autoload via Explicit Vars

- **WHEN** environment includes `SAP_AI_CORE_URL`, `SAP_AI_CORE_CLIENT_ID`, `SAP_AI_CORE_CLIENT_SECRET`, `SAP_AI_CORE_OAUTH_URL`
- **THEN** provider initializes without service key JSON

#### Scenario: Not Loaded Without Credentials

- **WHEN** none of required credentials exist
- **THEN** provider SHALL NOT appear in `Provider.list()` results

### Requirement: SAP AI Core Authentication

The system MUST obtain and cache an OAuth2 access token per unique credential set and refresh before expiry.

#### Scenario: Initial Token Fetch

- **WHEN** first model call occurs and cached token missing/expired
- **THEN** system requests token using client credentials grant and stores expiry (buffer ≥60s)

#### Scenario: Token Reuse

- **WHEN** subsequent call occurs before expiry
- **THEN** existing token is reused (no new network request)

#### Scenario: Failed Token Request

- **WHEN** token endpoint responds non-2xx
- **THEN** error surfaced as `ProviderInitError` with providerID `sap-ai-core` and original HTTP status mapped

### Requirement: SAP AI Core Model Resolution

The system SHALL resolve models by deployment identifier or alias and map to SAP AI Core inference endpoint.

#### Scenario: User Selects Deployment ID

- **WHEN** user sets model `sap-ai-core/<deploymentId>`
- **THEN** system calls endpoint constructed from base URL + deployment path

#### Scenario: Alias Mapping

- **WHEN** config provides `{ models: { my-gpt: { id: "<deploymentId>" } } }`
- **THEN** selecting `sap-ai-core/my-gpt` resolves real deployment ID

#### Scenario: Unknown Model

- **WHEN** requested model alias or deployment does not exist
- **THEN** system raises `ProviderModelNotFoundError`

### Requirement: SAP AI Core Option Injection

The system MUST support provider-specific request options (timeout, region override, tracing headers).

#### Scenario: Timeout Option

- **WHEN** user sets `provider.options.timeout = 15000`
- **THEN** fetch wrapper enforces 15s client-side abort using combined signals

#### Scenario: Region Header

- **WHEN** config sets `provider.options.region = "eu10"`
- **THEN** outgoing inference request includes header `AI-Core-Region: eu10`

### Requirement: SAP AI Core Token Refresh Strategy

The system MUST refresh tokens proactively.

#### Scenario: Early Refresh Buffer

- **WHEN** token expires in ≤60 seconds
- **THEN** a new token is fetched before initiating model call

#### Scenario: Concurrent Calls

- **WHEN** multiple calls trigger refresh simultaneously
- **THEN** only one network request is performed (others await same promise)

### Requirement: SAP AI Core Error Normalization

Errors MUST be normalized to existing provider error taxonomy.

#### Scenario: 401 Unauthorized

- **WHEN** inference endpoint returns 401
- **THEN** system surfaces `ProviderAuthError` with providerID and original code

#### Scenario: 429 Throttling

- **WHEN** API returns 429
- **THEN** system raises `ProviderRateLimitError` including optional `retry` milliseconds parsed from `Retry-After` header

### Requirement: SAP AI Core Observability

Minimal telemetry MUST be emitted for initialization and model usage.

#### Scenario: Init Log

- **WHEN** provider successfully loads
- **THEN** log entry with `{ service:"provider", providerID:"sap-ai-core", event:"init" }`

#### Scenario: Model Call Timing

- **WHEN** model call completes
- **THEN** timing logged with duration ms and success boolean

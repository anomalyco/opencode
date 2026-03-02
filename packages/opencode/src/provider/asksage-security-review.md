# AskSage Provider Integration - Security Review

**Reviewer:** security-reviewer
**Date:** 2026-03-01
**Scope:** AskSage provider additions in `packages/opencode/src/provider/provider.ts`
**Status:** PASS (with recommendations)

---

## 1. Authentication Security

### 1.1 API Key Handling - PASS

- API key sourced via `ASKSAGE_API_KEY` environment variable (line 885) or
  `Auth.set("asksage", ...)` through the Auth module
- Key flows through the existing provider loading pipeline:
  - Env loading (lines 987-997): key extracted from `Env.all()`, stored in
    `provider.key`
  - Auth loading (lines 999-1008): key loaded from `Auth.get()`, stored in
    `provider.key`
  - SDK creation (line 1154): `provider.key` assigned to `options["apiKey"]`
  - Passed to `createAnthropic()` which sends it as the `x-api-key` header
- Auth module stores credentials in `auth.json` with `0o600` file permissions
  (owner read/write only) - verified in `auth/index.ts:61`

### 1.2 No Hardcoded Credentials - PASS

- No API keys, tokens, or secrets are hardcoded in the implementation
- The `autoload: false` setting (line 593) ensures the provider never
  activates without explicit user credentials

### 1.3 No Token Refresh Flow - PASS

- No implementation of the `/user/get-token-with-api-key` endpoint
- No 24-hour temporary token logic
- Direct API key authentication only, as recommended

### 1.4 No Credential Logging - PASS

- `log.info("using bundled provider", ...)` (line 1209) only logs `providerID`
  and `pkg` (npm package name), not the API key or options
- `log.info("found", ...)` (line 1120) only logs `providerID`
- SDK cache hash (line 1161) uses `Bun.hash.xxHash32` on serialized options
  (which includes apiKey) but this is a one-way hash used only as an
  internal Map key, never logged or exposed. Pre-existing pattern used by
  all providers.

---

## 2. Transport Security

### 2.1 Default Base URL - PASS

- Default base URL is `https://api.asksage.ai/server/anthropic` (line 813)
- Uses HTTPS scheme

### 2.2 Configurable Base URL - RECOMMENDATION

- Users can override `baseURL` via `opencode.json` provider options
- The existing `loadBaseURL` function (lines 77-85) performs environment
  variable substitution but does NOT validate the URL scheme
- A user could theoretically configure `http://` which would bypass TLS
- **This is a pre-existing architectural issue** affecting ALL providers,
  not introduced by the AskSage change
- **Recommendation:** For FedRAMP environments, documentation should
  emphasize that HTTPS is required. A future enhancement could add scheme
  validation to `loadBaseURL` for all providers.

### 2.3 TLS Certificate Validation - PASS

- No `NODE_TLS_REJECT_UNAUTHORIZED=0` found anywhere in the codebase
- Government instances requiring custom CAs use the standard
  `NODE_EXTRA_CA_CERTS` environment variable (handled by Node.js/Bun
  runtime, not by application code)
- No `rejectUnauthorized: false` in any fetch/TLS configuration

### 2.4 No HTTP Fallback - PASS

- No fallback logic from HTTPS to HTTP
- No retry-on-different-protocol logic

---

## 3. Input Validation

### 3.1 Model IDs - PASS

- Model IDs are hardcoded string constants (lines 830-875):
  `claude-sonnet-4-5-20250514`, `claude-sonnet-4-20250514`,
  `claude-opus-4-20250514`, `claude-3-5-haiku-20241022`
- No user input is interpolated into model IDs
- Model IDs follow the existing Anthropic naming convention

### 3.2 Base URL SSRF Risk - LOW RISK (Pre-existing)

- `loadBaseURL` (line 78) allows environment variable substitution
  via `${VAR}` patterns in the base URL string
- This is a pre-existing pattern, not introduced by AskSage
- The substitution only draws from `Env.get()` (process environment
  variables), which are controlled by the system administrator
- For AskSage, the default URL has no `${...}` placeholders

### 3.3 Header Injection - PASS

- Only the `anthropic-beta` header is added (lines 596-597)
- Header value is a hardcoded string constant, not user-configurable
- No user input flows into headers through the AskSage-specific code

---

## 4. Data Protection

### 4.1 No PII in Logs - PASS

- No logging statements in the AskSage-specific code
- Existing provider logging (lines 1120, 1209) only logs providerID
  and npm package name
- Error handling delegates to existing `ProviderError` module which
  processes API error messages but does not add provider-specific
  sensitive data

### 4.2 Error Message Safety - PASS

- AskSage uses the standard Anthropic error flow (via `@ai-sdk/anthropic`)
- `ProviderError.parseAPICallError` includes `responseBody` in error
  returns, but this is the standard Anthropic error body format which
  does not contain authentication tokens
- The `error()` function in error.ts has no special case for "asksage"
  providerID, so it returns raw error messages. Anthropic proxy errors
  should not contain API keys in response bodies.
- `metadata` field in parsed errors includes `url` (the request URL)
  but the Anthropic SDK does not embed API keys in URLs (uses headers)

### 4.3 SDK Cache Key - PASS

- The SDK cache uses `xxHash32` (line 1161) which is a non-reversible
  hash. Even though the serialized options include the API key, the
  hash cannot be used to recover the key.

---

## 5. FedRAMP High Specific

### 5.1 Encryption Standards - PASS (Delegated)

- TLS encryption is handled by the Node.js/Bun runtime, not by
  application code
- AskSage is FedRAMP High authorized with FIPS 140-3 validated
  cryptographic modules on the server side
- Client-side FIPS compliance depends on the runtime environment
  configuration (e.g., `--enable-fips` for Node.js), which is outside
  the scope of this integration

### 5.2 Data Residency - PASS

- All requests route through AskSage's proxy (no direct calls to
  underlying model providers like Anthropic)
- Government instance URLs are configurable (e.g.,
  `https://api.genai.army.mil/server/anthropic`)
- Data stays within AskSage's FedRAMP-authorized boundary

### 5.3 Audit Logging - INFORMATIONAL

- AskSage handles audit logging on the server side ("fire and forget"
  data handling)
- OpenCode's existing structured logging (`Log.create()`) provides
  client-side audit trail of provider interactions (providerID, timing)
- No additional audit logging specific to FedRAMP was added or needed

### 5.4 Session Management - PASS

- No session state maintained between requests
- No cookies, session tokens, or stateful connections
- Each request is independently authenticated via API key

---

## 6. Code Quality

### 6.1 Type Safety - PASS

- Model definitions use the existing `Model` type with proper typing
- `asksageBaseModel` uses spread operator correctly with typed constants
- `status: "active" as const` properly narrows the union type
- `capabilities` objects are fully specified (no missing fields)

### 6.2 Error Handling - PASS

- No new error handling code introduced
- Delegates to existing Anthropic SDK error handling
- `ProviderError` module already handles Anthropic-pattern errors
  (overflow detection, status code mapping)

### 6.3 No Unsafe Type Assertions - PASS

- Only one type assertion: `status: "active" as const` (line 816)
  which is safe and necessary for type narrowing

### 6.4 Resource Cleanup - PASS

- No new connections, timers, or resources created
- Uses existing provider lifecycle management
- SDK instances are cached via the existing `sdk` Map

### 6.5 Race Conditions - PASS

- Database entry is guarded by `if (!database["asksage"])` (line 809)
  which prevents duplicate registration
- Provider state initialization is synchronous within the `state()`
  function, so no race conditions

### 6.6 Transform Compatibility - PASS

- Since `api.npm` is `@ai-sdk/anthropic`, the following transforms
  apply automatically:
  - Message normalization (empty content filtering, tool call ID
    sanitization for Claude models)
  - Cache control (ephemeral caching via Anthropic providerOptions)
  - Temperature handling (returns `undefined` for Claude models)
  - Provider options remapping (providerID "asksage" remapped to
    SDK key "anthropic")
- Verified in `transform.ts`: the `sdkKey()` function maps
  `@ai-sdk/anthropic` to `"anthropic"` (line 33), ensuring correct
  providerOptions routing

---

## 7. Summary

### Findings

| # | Severity | Category | Finding |
|---|----------|----------|---------|
| 1 | Low | Transport | Base URL not validated for HTTPS scheme (pre-existing, all providers) |
| 2 | Info | Data | Cost data uses direct Anthropic pricing; AskSage may charge differently |
| 3 | Info | FedRAMP | Client-side FIPS 140-3 compliance depends on runtime configuration |

### Verdict

**PASS** - The AskSage provider integration is secure and follows all
existing security patterns in the codebase. No new vulnerabilities are
introduced. The implementation correctly:

- Uses the existing Auth module for credential storage (0o600 permissions)
- Defaults to HTTPS for all API communication
- Does not log sensitive data (API keys, tokens, headers)
- Does not implement unnecessary auth flows (no token refresh)
- Does not disable TLS certificate validation
- Properly delegates to the Anthropic SDK for request authentication
- Uses `autoload: false` to prevent activation without explicit credentials
- Maintains type safety with no unsafe assertions

The one low-severity finding (HTTPS scheme validation) is a pre-existing
architectural consideration that affects all providers equally and is not
specific to the AskSage integration.

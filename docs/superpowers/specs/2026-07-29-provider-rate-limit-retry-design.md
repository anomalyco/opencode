# Provider-local HTTP 400 rate-limit retry

## Goal

Allow a provider to opt in to retrying a non-standard HTTP 400 response whose JSON `detail` says that its rate limit was exceeded.

## Configuration

Configure the behavior per provider in `opencode.json`:

```json
{
  "provider": {
    "my-provider": {
      "options": {
        "retry400RateLimit": true
      }
    }
  }
}
```

The default is `false`. The flag affects only the configured provider.

## Design

`SessionProcessor` reads the option for the model's provider when it creates a processor. It passes the resulting boolean through `MessageV2.fromError` to `ProviderError.parseAPICallError`.

The parser marks an HTTP 400 as retryable only when all conditions hold:

1. `retry400RateLimit` is enabled for that provider.
2. The response body is JSON with a string `detail` field.
3. That field contains `rate limit exceeded`, case-insensitively.

No other HTTP 400 response becomes retryable. The new setting is used only for error classification and is not sent as an SDK request option.

## Tests

Tests cover a rate-limit HTTP 400 with the flag off and on, plus a generic HTTP 400 while the flag is on. Existing retry behavior remains unchanged.

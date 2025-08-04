# Rate Limiting Configuration

OpenCode now supports rate limiting for LLM requests to help manage API usage with providers that have rate limits.

## Configuration

To configure rate limiting, add the `rate_limit` option to your `opencode.json` configuration file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "rate_limit": 15
}
```

The `rate_limit` value is specified in requests per minute. For example:
- `15` = 15 requests per minute (1 request every 4 seconds)
- `30` = 30 requests per minute (1 request every 2 seconds)
- `60` = 60 requests per minute (1 request every second)

## How It Works

When rate limiting is enabled:
1. OpenCode tracks the time of the last LLM request
2. Before each new request, it calculates the required delay to maintain the specified rate
3. If needed, it waits before sending the request to ensure the rate limit is not exceeded

## Use Cases

This feature is particularly useful when:
- Working with providers that have strict rate limits
- Sharing API keys across multiple applications
- Wanting to conserve API usage credits
- Testing applications with rate-limited endpoints

## Disabling Rate Limiting

To disable rate limiting, simply omit the `rate_limit` option from your configuration or set it to `0`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "rate_limit": 0
}
# Setting Up GLM 4.6 on Cerebras

This guide shows you how to configure GLM 4.6 on Cerebras with OpenCode and addresses the three critical scaling issues.

## Quick Setup

### 1. Get Your Cerebras API Key

1. Sign up at [Cerebras Inference](https://inference.cerebras.ai/)
2. Generate an API key from your dashboard

### 2. Add Credentials

```bash
cerebras auth login
# Select "Other"
# Enter provider ID: cerebras
# Enter your Cerebras API key
```

### 3. Configure in `opencode.json` or `cerebras.json`

Create a configuration file in your project or globally at `~/.local/share/cerebras/config/cerebras.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cerebras": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cerebras",
      "options": {
        "baseURL": "https://api.cerebras.ai/v1"
      },
      "models": {
        "llama3.1-8b": {
          "name": "Llama 3.1 8B",
          "limit": {
            "context": 8192,
            "output": 4096
          }
        },
        "llama-3.3-70b": {
          "name": "Llama 3.3 70B",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "glm-4-6b": {
          "name": "GLM 4.6",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  }
}
```

### 4. Select Your Model

```bash
cerebras
# Press Ctrl+M or run /models
# Select "GLM 4.6"
```

## Solution to Scaling Problems

### Problem 1: Abuse & Cost Bleed

**Solution Implemented:**

- **Retry Budget**: Maximum 5 retry attempts per session (configurable via `RETRY_MAX_ATTEMPTS`)
- **Exponential Backoff with Jitter**: Prevents rapid retry loops
  - Initial delay: 2 seconds
  - Backoff factor: 2x
  - Max delay: 30 seconds
  - 10% jitter to prevent thundering herd

**Code Location**: `/packages/cerebras/src/session/retry.ts`

**Example**:

```typescript
export const RETRY_MAX_ATTEMPTS = 5 // Stops infinite loops
export const RETRY_JITTER_FACTOR = 0.1 // Prevents synchronized retries
```

### Problem 2: Poor UX on Limits

**Solution Implemented:**

- **Graceful Error Messages**: User-friendly messages for rate limits
- **Retry Status Updates**: Shows countdown until next retry
- **429-Specific Handling**: Explicit detection of rate limit errors

**User Experience**:

```
❌ Rate limit reached. Waiting before retry... (Attempt 1/5)
⏱️  Next attempt in 3 seconds...
```

**Code Location**: `/packages/cerebras/src/session/processor.ts:370-377`

### Problem 3: Inefficiency

**Solution Implemented:**

- **Cerebras-Specific Custom Loader**: Optimized headers and client identification
- **Request Deduplication Headers**: Cache-Control headers to prevent redundant requests
- **Intelligent Retry Logic**: Respects `Retry-After` headers from API

**Code Location**: `/packages/cerebras/src/provider/provider.ts:62-91`

**Features**:

```typescript
{
  headers: {
    "X-Client": "cerebras",
    "X-Client-Version": "1.0",
    "Cache-Control": "no-cache"
  }
}
```

## Advanced Configuration

### Adjust Retry Behavior

Edit `/packages/cerebras/src/session/retry.ts`:

```typescript
export const RETRY_INITIAL_DELAY = 2000 // Start with 2s delay
export const RETRY_BACKOFF_FACTOR = 2 // Double each time
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // Cap at 30s
export const RETRY_MAX_ATTEMPTS = 5 // Stop after 5 attempts
export const RETRY_JITTER_FACTOR = 0.1 // 10% randomization
```

### Per-Model Configuration

You can configure different limits per model:

```json
{
  "provider": {
    "cerebras": {
      "models": {
        "glm-4-6b": {
          "name": "GLM 4.6",
          "limit": {
            "context": 128000,
            "output": 8192
          },
          "options": {
            "temperature": 0.7,
            "topP": 0.9
          }
        }
      }
    }
  }
}
```

## Monitoring Rate Limits

### Check Logs

Retry attempts are logged with detailed information:

```bash
cerebras --verbose
```

Look for log entries:

- `"retrying after error"` - Shows retry attempt details
- `"max retries exceeded"` - Indicates hitting retry budget
- `statusCode: 429` - Rate limit detected

### Error Messages

Users will see clear error messages:

1. **During Retry**:

   ```
   Rate limit reached. Waiting before retry... (Attempt 2/5)
   Next attempt in 6 seconds...
   ```

2. **After Max Retries**:
   ```
   Failed after 5 attempts. You may be hitting rate limits.
   Consider switching to a different model or waiting a few minutes.
   ```

## Best Practices

1. **Use Smaller Models for Simple Tasks**: Switch to `llama3.1-8b` for basic queries to save quota
2. **Monitor Your Usage**: Check Cerebras dashboard for rate limit status
3. **Implement Request Queuing**: For high-volume applications, add a queue layer
4. **Set Up Alerts**: Monitor logs for `429` errors to detect abuse patterns

## Troubleshooting

### Issue: Constant 429 Errors

**Solution**:

- Wait for rate limit window to reset (typically hourly)
- Switch to a different model temporarily
- Check if you have multiple processes running

### Issue: Slow Responses

**Solution**:

- Reduce `context` size in model config
- Use streaming for better perceived performance
- Enable caching (if supported by Cerebras)

### Issue: API Key Not Working

**Solution**:

```bash
cerebras auth list  # Check if key is stored
cerebras auth login  # Re-add if missing
```

## Implementation Details

### Retry Flow

```
User Request
     ↓
API Call to Cerebras
     ↓
  [Error?] ──No──→ Success
     ↓ Yes
Rate Limit (429)?
     ↓ Yes
Attempt < 5?
     ↓ Yes
Calculate Delay (exponential + jitter)
     ↓
Show Retry Status to User
     ↓
Sleep with Jitter
     ↓
Retry API Call
     ↓
[Repeat until success or max attempts]
     ↓
Max attempts exceeded?
     ↓ Yes
Show Error: "Consider switching models..."
```

### Key Files Modified

1. `/packages/cerebras/src/provider/provider.ts` - Cerebras custom loader
2. `/packages/cerebras/src/session/retry.ts` - Enhanced retry logic
3. `/packages/cerebras/src/session/processor.ts` - Retry budget enforcement

## API Reference

### SessionRetry Constants

| Constant                     | Default | Description            |
| ---------------------------- | ------- | ---------------------- |
| `RETRY_INITIAL_DELAY`        | 2000ms  | Starting retry delay   |
| `RETRY_BACKOFF_FACTOR`       | 2       | Exponential multiplier |
| `RETRY_MAX_DELAY_NO_HEADERS` | 30000ms | Maximum delay cap      |
| `RETRY_MAX_ATTEMPTS`         | 5       | Retry budget limit     |
| `RETRY_JITTER_FACTOR`        | 0.1     | Jitter percentage      |

### Functions

- `SessionRetry.delay(attempt, error)` - Calculates retry delay with jitter
- `SessionRetry.isRateLimitError(error)` - Detects 429 errors
- `SessionRetry.sleep(ms, signal)` - Async sleep with abort support

## Support

For issues or questions:

1. Check logs with `cerebras --verbose`
2. Review [Cerebras API Documentation](https://inference.cerebras.ai/docs)
3. Open an issue on GitHub

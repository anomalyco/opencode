# Rate Limit Handling - Quick Reference

## For Users

### Setup GLM 4.6 on Cerebras

```bash
# 1. Add API key
cerebras auth login
# Select "Other" → Enter "cerebras" → Paste API key

# 2. Create config
cat > cerebras.json <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "cerebras": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cerebras",
      "options": {"baseURL": "https://api.cerebras.ai/v1"},
      "models": {
        "glm-4-6b": {
          "name": "GLM 4.6",
          "limit": {"context": 128000, "output": 8192}
        }
      }
    }
  }
}
EOF

# 3. Select model
cerebras  # then Ctrl+M to select GLM 4.6
```

### Error Messages You Might See

| Message | What It Means | What To Do |
|---------|---------------|------------|
| "Rate limit reached. Waiting before retry..." | You hit API rate limit | Wait for automatic retry (shown in status) |
| "Failed after 5 attempts. You may be hitting rate limits..." | Exceeded retry budget | Wait a few minutes, or switch models |
| "Provider is overloaded. Waiting before retry..." | Cerebras servers are busy | Wait for automatic retry |

---

## For Developers

### Key Files

| File | Purpose |
|------|---------|
| `packages/cerebras/src/session/retry.ts` | Retry logic, backoff, jitter |
| `packages/cerebras/src/session/processor.ts` | Retry enforcement, error handling |
| `packages/cerebras/src/provider/provider.ts` | Cerebras custom loader |
| `packages/cerebras/test/session/retry.test.ts` | Test suite |

### Configuration Constants

```typescript
// packages/cerebras/src/session/retry.ts

export const RETRY_INITIAL_DELAY = 2000        // Start: 2s
export const RETRY_BACKOFF_FACTOR = 2          // Multiply: 2x
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000  // Cap: 30s
export const RETRY_MAX_ATTEMPTS = 5            // Budget: 5 attempts
export const RETRY_JITTER_FACTOR = 0.1         // Jitter: ±10%
```

### API

```typescript
// Check if error is rate limit
SessionRetry.isRateLimitError(error?: MessageV2.APIError): boolean

// Calculate delay with backoff + jitter
SessionRetry.delay(attempt: number, error?: MessageV2.APIError): number

// Sleep with abort support
SessionRetry.sleep(ms: number, signal: AbortSignal): Promise<void>
```

### Retry Flow

```
API Call
   ↓
Error? ─No→ Success
   ↓ Yes
Retryable? ─No→ Fail
   ↓ Yes
Attempt < 5? ─No→ Fail with message
   ↓ Yes
Calculate delay (exponential + jitter)
   ↓
Show status to user
   ↓
Sleep(delay)
   ↓
Retry API Call
```

### Delay Calculation

```typescript
// Normal error (attempt 1-5)
delay = min(2000 * 2^(attempt-1), 30000) ± 10% jitter
// Example: 2s, 4s, 8s, 16s, 30s

// Rate limit 429 (attempt 1-5)
delay = min(2000 * 2^attempt, 30000) ± 10% jitter
// Example: 4s, 8s, 16s, 30s, 30s (more aggressive)

// With Retry-After header
delay = header_value ± 10% jitter
// Always respects API guidance
```

### Adding to Logs

```typescript
import { SessionRetry } from "@/session/retry"

log.info("retry attempt", {
  attempt,
  delay: SessionRetry.delay(attempt, error),
  isRateLimit: SessionRetry.isRateLimitError(error),
  statusCode: error?.data.statusCode,
})
```

### Testing

```bash
# Run all retry tests
bun test test/session/retry.test.ts

# Run specific test
bun test test/session/retry.test.ts -t "rate limit"

# Check build
bun run build
```

### Monitoring

```bash
# Enable verbose logging
cerebras --verbose

# Watch for rate limits
cerebras --verbose 2>&1 | grep "isRateLimit: true"

# Watch for max retries
cerebras --verbose 2>&1 | grep "max retries exceeded"
```

### Tuning Guide

| Scenario | Adjustment | Setting |
|----------|------------|---------|
| Too many retries | Lower budget | `RETRY_MAX_ATTEMPTS = 3` |
| Retry too slow | Faster backoff | `RETRY_BACKOFF_FACTOR = 1.5` |
| Thundering herd | More jitter | `RETRY_JITTER_FACTOR = 0.2` |
| API requests too fast | Higher initial delay | `RETRY_INITIAL_DELAY = 3000` |

### Example: Custom Retry Policy

```typescript
// packages/cerebras/src/session/retry.ts

// For high-priority users
export const RETRY_MAX_ATTEMPTS = 10

// For development/testing (fail fast)
export const RETRY_MAX_ATTEMPTS = 2

// For global rate limits (slower backoff)
export const RETRY_BACKOFF_FACTOR = 3
```

---

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
rm -rf dist/ node_modules/.cache/
bun install
bun run build
```

### Test Failures

```bash
# Jitter can cause timing issues in tests
# If tests fail sporadically, widen the ranges:
expect(delay).toBeGreaterThanOrEqual(expected * 0.85)
expect(delay).toBeLessThanOrEqual(expected * 1.15)
```

### TypeScript Errors

```bash
# Check types
bun run typecheck  # if available

# Or build (includes type checking)
bun run build
```

---

## Best Practices

### DO

- ✅ Use `SessionRetry.delay()` for all retry calculations
- ✅ Check `isRateLimitError()` for 429 handling
- ✅ Respect `Retry-After` headers
- ✅ Log retry attempts with context
- ✅ Show user-friendly messages

### DON'T

- ❌ Hardcode delays
- ❌ Retry without budget/limit
- ❌ Ignore 429 status codes
- ❌ Remove jitter (causes thundering herd)
- ❌ Skip error logging

---

## Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Retry success rate | >70% | Test in production |
| Max retries hit | <10% | Monitor logs |
| Average retries per request | <2 | Calculate from logs |
| 429 errors per hour | <100 | Track via metrics |

---

## Emergency Procedures

### If 429 errors spike

1. Check Cerebras status page
2. Verify rate limits haven't changed
3. Look for runaway scripts (same session ID repeatedly)
4. Temporarily lower `RETRY_MAX_ATTEMPTS`
5. Contact Cerebras support

### If users complain about slow responses

1. Check average retry count in logs
2. Verify not hitting max attempts frequently
3. Consider reducing `RETRY_INITIAL_DELAY`
4. Check for network issues

### If costs increase unexpectedly

1. Check retry count distribution
2. Verify jitter is enabled
3. Look for infinite loop patterns
4. Audit API key usage

---

## Useful Commands

```bash
# Count rate limit errors
grep -c "statusCode: 429" /path/to/logs

# Average retry count
grep "retrying after error" /path/to/logs | \
  grep -oP 'attempt: \K\d+' | \
  awk '{sum+=$1; count++} END {print sum/count}'

# Most common retry reasons
grep "retrying after error" /path/to/logs | \
  grep -oP 'message: "\K[^"]+' | \
  sort | uniq -c | sort -rn | head -10
```

---

## Quick Checklist

Before deploying changes:

- [ ] Tests pass (`bun test test/session/retry.test.ts`)
- [ ] Build succeeds (`bun run build`)
- [ ] Logs contain retry info
- [ ] Error messages are user-friendly
- [ ] Retry budget enforced
- [ ] Jitter is enabled
- [ ] 429 detection works
- [ ] Documentation updated

---

## References

- [Cerebras API Documentation](https://inference.cerebras.ai/docs)
- [Exponential Backoff - Wikipedia](https://en.wikipedia.org/wiki/Exponential_backoff)
- [Retry After Header - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After)
- [Thundering Herd Problem](https://en.wikipedia.org/wiki/Thundering_herd_problem)

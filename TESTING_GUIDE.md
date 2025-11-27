# Testing Guide - Phase 1 Security Features

This guide shows you how to test all the new security and efficiency features.

## Quick Start

```bash
# Run all tests
bun test

# Run specific test suites
bun test test/session/retry.test.ts
bun test test/session/abuse-detection.test.ts
bun test test/session/cache-optimizer.test.ts

# Run with coverage
bun test --coverage
```

---

## Feature 1: Rate Limit Handling with Jitter

### What It Does

- Automatic retry with exponential backoff + 10% jitter
- Explicit 429 detection
- Max 5 retry attempts per session
- User-friendly error messages

### How to Test

#### Unit Tests

```bash
bun test test/session/retry.test.ts
```

Expected output:

```
✓ 11 tests pass
✓ caps delay at 30 seconds when headers missing (with jitter)
✓ detects 429 rate limit errors
✓ uses aggressive backoff for 429 errors
```

#### Manual Test - Simulate Rate Limits

1. **Trigger rapid requests** (will hit your actual API limits):

```bash
# Start cerebras CLI
cerebras

# Then make many rapid requests
```

2. **Expected behavior**:

```
Rate limit reached. Waiting before retry... (Attempt 1/5)
Next attempt in 4 seconds...

Rate limit reached. Waiting before retry... (Attempt 2/5)
Next attempt in 8 seconds...
```

3. **After 5 retries**:

```
❌ Failed after 5 attempts. You may be hitting rate limits.
Consider switching to a different model or waiting a few minutes.
```

---

## Feature 2: Abuse Pattern Detection

### What It Does

- Detects identical prompts (infinite loops)
- Monitors burst requests (>10 req/s)
- Identifies lopsided token usage
- Tracks prompt size growth

### How to Test

#### Unit Tests

```bash
bun test test/session/abuse-detection.test.ts
```

Expected output:

```
✓ detects repeated identical prompts
✓ detects high frequency requests
✓ detects high input to output ratio
✓ detects uncontrollable prompt growth
```

#### Manual Test 1 - Identical Prompts

Create a test script `test-identical.ts`:

```typescript
import { AbuseDetection } from "./packages/cerebras/src/session/abuse-detection"

const sessionID = "test-session"
const prompt = "Tell me a joke"

for (let i = 0; i < 5; i++) {
  const result = AbuseDetection.detect({
    sessionID,
    prompt,
    promptTokenCount: 100,
  })

  console.log(`Attempt ${i + 1}:`, result)
}
```

Run:

```bash
bun run test-identical.ts
```

Expected output:

```
Attempt 1: null
Attempt 2: null
Attempt 3: {
  pattern: 'identical_prompts',
  severity: 'critical',
  message: 'Detected 3 identical prompts in a row. This may indicate an infinite loop.',
  suggestion: 'Check your code for infinite loops...'
}
```

#### Manual Test 2 - Burst Requests

Create `test-burst.ts`:

```typescript
import { AbuseDetection } from "./packages/cerebras/src/session/abuse-detection"

const sessionID = "burst-test"

for (let i = 0; i < 12; i++) {
  const result = AbuseDetection.detect({
    sessionID,
    prompt: `Request ${i}`,
    promptTokenCount: 100,
  })

  if (result) {
    console.log(`Triggered at request ${i + 1}:`, result)
  }
}
```

Expected: Warning at request 10 (BURST_REQUEST_THRESHOLD).

#### Manual Test 3 - Lopsided Tokens

Create `test-lopsided.ts`:

```typescript
import { AbuseDetection } from "./packages/cerebras/src/session/abuse-detection"

const result = AbuseDetection.detect({
  sessionID: "lopsided-test",
  prompt: "Very long prompt with lots of tokens",
  promptTokenCount: 3000,
  inputTokens: 3000,
  outputTokens: 20, // 150:1 ratio
})

console.log("Result:", result)
```

Expected output:

```
{
  pattern: 'lopsided_tokens',
  severity: 'warning',
  message: 'Lopsided token usage detected: 3000 input / 20 output (150.0:1 ratio).',
  suggestion: 'You're sending large inputs but getting minimal outputs...'
}
```

---

## Feature 3: Session Token Budgets

### What It Does

- Tracks total tokens per session
- Warns at 80%, critical at 95%
- Hard stop at 100% (default: 1M tokens)
- Configurable limits

### How to Test

#### Unit Test (Create One)

Create `test/session/token-budget.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { TokenBudget } from "../../src/session/token-budget"

describe("TokenBudget", () => {
  test("tracks token usage", async () => {
    const result = await TokenBudget.track({
      sessionID: "test",
      inputTokens: 100,
      outputTokens: 200,
    })

    expect(result.allowed).toBe(true)
    expect(result.usage.totalTokens).toBe(300)
  })

  test("warns at 80% threshold", async () => {
    const sessionID = "warning-test"

    // Use 80% of default budget (1M tokens)
    const result = await TokenBudget.track({
      sessionID,
      inputTokens: 800_000,
      outputTokens: 0,
    })

    expect(result.allowed).toBe(true)
    expect(result.message).toContain("Warning")
  })

  test("blocks at 100% threshold", async () => {
    const sessionID = "exceed-test"

    // Exceed budget
    const result = await TokenBudget.track({
      sessionID,
      inputTokens: 1_000_000,
      outputTokens: 1,
    })

    expect(result.allowed).toBe(false)
    expect(result.message).toContain("exceeded")
  })
})
```

Run:

```bash
bun test test/session/token-budget.test.ts
```

#### Manual Test - Session Budget

1. **Configure custom budget** (optional):

Create `cerebras.json`:

```json
{
  "session": {
    "max_tokens_per_session": 10000
  }
}
```

2. **Monitor usage** (via logs):

```bash
cerebras --verbose 2>&1 | grep "token usage tracked"
```

3. **Expected log output**:

```
token usage tracked { sessionID: 'abc123', totalTokens: 8500, percentage: '85.0%' }
⚠️ Warning: 85% of token budget used (8,500 / 10,000).
```

---

## Feature 4: Cache Optimization

### What It Does

- Normalizes whitespace
- Canonicalizes file paths
- Removes non-deterministic data (timestamps, UUIDs)
- Generates stable cache keys

### How to Test

#### Unit Tests

```bash
bun test test/session/cache-optimizer.test.ts
```

Expected output:

```
✓ normalizes multiple spaces
✓ removes user-specific paths
✓ removes ISO timestamps
✓ generates consistent cache keys
✓ analyzes cache hit potential
```

#### Manual Test - Cache Matching

Create `test-cache.ts`:

```typescript
import { CacheOptimizer } from "./packages/cerebras/src/session/cache-optimizer"

const prompt1 = `
  File:   /Users/john/project/src/main.ts
  Time:  2025-11-27T08:30:00.123Z
`

const prompt2 = `
File: /Users/jane/project/src/main.ts
Time: 2025-11-27T09:45:00.456Z
`

const opt1 = CacheOptimizer.optimize({ prompt: prompt1, workspaceRoot: "/Users/john/project" })
const opt2 = CacheOptimizer.optimize({ prompt: prompt2, workspaceRoot: "/Users/jane/project" })

console.log("Prompt 1 cache key:", opt1.cacheKey)
console.log("Prompt 2 cache key:", opt2.cacheKey)
console.log("Match:", opt1.cacheKey === opt2.cacheKey)
console.log("\nTransformations:")
console.log("Prompt 1:", opt1.transformations)
console.log("Prompt 2:", opt2.transformations)
```

Run:

```bash
bun run test-cache.ts
```

Expected output:

```
Prompt 1 cache key: a1b2c3d4e5f6g7h8
Prompt 2 cache key: a1b2c3d4e5f6g7h8
Match: true

Transformations:
Prompt 1: [ 'whitespace_normalized', 'paths_canonicalized', 'nondeterministic_removed' ]
Prompt 2: [ 'whitespace_normalized', 'paths_canonicalized', 'nondeterministic_removed' ]
```

#### Cache Hit Analysis

Create `analyze-cache.ts`:

```typescript
import { CacheOptimizer } from "./packages/cerebras/src/session/cache-optimizer"

const prompts = [
  "What is 2+2?",
  "What  is  2+2?", // Same after normalization
  "Tell me a joke",
  "Tell me a joke", // Duplicate
  "Hello world",
  "Error at 2025-11-27T08:30:00Z in session_abc123",
  "Error at 2025-11-27T09:45:00Z in session_xyz789", // Same after removing timestamps
]

const analysis = CacheOptimizer.analyzeCachePotential(prompts)

console.log("Analysis:", JSON.stringify(analysis, null, 2))
```

Expected output:

```json
{
  "totalPrompts": 7,
  "uniquePrompts": 4,
  "duplicatePrompts": 3,
  "potentialCacheHitRate": 0.43,
  "averageTransformations": 1.2,
  "topCacheKeys": [...]
}
```

---

## Integration Testing

### End-to-End Test Scenario

1. **Setup**:

```bash
cd /Users/ari/GitHub/opencode/packages/cerebras
```

2. **Run full test suite**:

```bash
bun test
```

3. **Expected results**:

```
✓ 11 tests pass (retry.test.ts)
✓ 15 tests pass (abuse-detection.test.ts)
✓ 20 tests pass (cache-optimizer.test.ts)
✓ 5 tests pass (token-budget.test.ts) # when created

Total: 51 tests pass
```

### Performance Test

Create `perf-test.ts`:

```typescript
import { CacheOptimizer } from "./packages/cerebras/src/session/cache-optimizer"
import { AbuseDetection } from "./packages/cerebras/src/session/abuse-detection"

console.time("Cache optimization - 1000 prompts")
for (let i = 0; i < 1000; i++) {
  CacheOptimizer.optimize({
    prompt: `Test prompt ${i} with /Users/test/path at ${Date.now()}`,
    workspaceRoot: "/Users/test",
  })
}
console.timeEnd("Cache optimization - 1000 prompts")

console.time("Abuse detection - 1000 checks")
for (let i = 0; i < 1000; i++) {
  AbuseDetection.detect({
    sessionID: "perf-test",
    prompt: `Request ${i}`,
    promptTokenCount: 100,
  })
}
console.timeEnd("Abuse detection - 1000 checks")
```

Expected: Both should complete in <100ms.

---

## Debugging Failed Tests

### Common Issues

**Issue**: Tests fail sporadically

- **Cause**: Jitter in retry delays
- **Fix**: Widen test ranges (±15% instead of ±10%)

**Issue**: Abuse detection doesn't trigger

- **Cause**: Test runs too slowly (timestamps spread apart)
- **Fix**: Run detections in rapid succession

**Issue**: Cache keys don't match

- **Cause**: Workspace root differences
- **Fix**: Use consistent workspace roots in tests

### Debug Mode

Enable verbose logging:

```bash
# In tests
LOG_LEVEL=debug bun test

# In CLI
cerebras --verbose
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Phase 1 Features

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test test/session/retry.test.ts
      - run: bun test test/session/abuse-detection.test.ts
      - run: bun test test/session/cache-optimizer.test.ts
```

---

## Metrics to Monitor

After deployment, track these metrics:

### Rate Limiting

```bash
# Count 429 errors
grep -c "statusCode.*429" /path/to/logs

# Average retry count
grep "retrying after error" /path/to/logs | grep -oP 'attempt: \K\d+' | awk '{sum+=$1; count++} END {print sum/count}'
```

### Abuse Detection

```bash
# Pattern frequency
grep "abuse pattern detected" /path/to/logs | grep -oP 'pattern: "\K[^"]+' | sort | uniq -c

# Most common pattern
grep "abuse pattern detected" /path/to/logs | grep -oP 'pattern: "\K[^"]+' | sort | uniq -c | sort -rn | head -1
```

### Token Budgets

```bash
# Sessions hitting warnings
grep "Warning.*token budget" /path/to/logs | wc -l

# Sessions exceeding budget
grep "token budget exceeded" /path/to/logs | wc -l
```

### Cache Optimization

```bash
# Cache hit rate (needs instrumentation)
# Add logging in production, then:
grep "cache hit" /path/to/logs | wc -l
```

---

## Troubleshooting

### Tests Won't Run

```bash
# Clear cache
rm -rf node_modules/.cache/

# Reinstall
bun install

# Try again
bun test
```

### Type Errors

```bash
# Run typecheck
bun run typecheck

# Common fixes
#  - Import NamedError from @cerebras-ai/util/error
#  - Use proper type narrowing for MessageV2.APIError
```

### Import Errors

If you see "Cannot find module":

```bash
# Check if file exists
ls packages/cerebras/src/session/abuse-detection.ts

# Verify exports
grep "export" packages/cerebras/src/session/abuse-detection.ts
```

---

## Next Steps

After testing Phase 1 features:

1. ✅ Confirm all unit tests pass
2. ✅ Run manual tests for each feature
3. ✅ Check logs for warnings/errors
4. ✅ Monitor metrics in production
5. 🔜 Proceed to Phase 2 features (when ready)

---

## Questions?

- Check `RATE_LIMIT_QUICK_REF.md` for developer reference
- See `IMPLEMENTATION_SUMMARY.md` for technical details
- Review `CEREBRAS_GLM_SETUP.md` for user setup guide

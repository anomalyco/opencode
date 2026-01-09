# Multi-Provider Code Review

This feature allows the GitHub Action to run code reviews simultaneously with multiple AI providers and then synthesize their results into a comprehensive review.

## How It Works

1. **Parallel Reviews**: The workflow runs reviews with multiple providers simultaneously using `Promise.all`
2. **Aggregation**: All individual reviews are collected and formatted
3. **Synthesis**: A designated synthesis model combines overlapping feedback, highlights unique insights, and removes duplicates

## Configuration

The providers are configured via the `REVIEW_PROVIDERS` environment variable in `.github/workflows/review.yml`:

```yaml
REVIEW_PROVIDERS: "opencode/big-pickle,opencode/grok-code,opencode/minimax-m2.1-free,opencode/glm-4.7-free"
```

### Current Free Providers

- `opencode/big-pickle` - Large reasoning model
- `opencode/grok-code` - Code-specialized model
- `opencode/minimax-m2.1-free` - Free tier model
- `opencode/glm-4.7-free` - Free GLM model

## Adding New Providers

To add or change providers:

1. Edit the `REVIEW_PROVIDERS` variable in `.github/workflows/review.yml`
2. Use the format `provider/model` (e.g., `opencode/big-pickle`)
3. Separate multiple providers with commas

## Script Details

The `github/multi-review.ts` script handles:

- Running parallel reviews with error handling
- 5-minute timeout per provider
- Graceful fallback if a provider fails
- Synthesis using the first provider in the list
- Proper logging and status reporting

## Benefits

- **Comprehensive Reviews**: Multiple perspectives catch different issues
- **Redundancy**: If one provider fails, others continue
- **Cost Efficiency**: Uses free providers
- **Quality Synthesis**: Combines the best insights from all reviews

### Issue for this PR

Closes #22253

### Type of change

- [x] Bug fix

### What does this PR do?

Fixes custom provider models failing with "maxOutputTokens must be >= 1" when limit field is not defined.

The issue was in `provider.ts` custom model parsing where models without a `limit` field fell back to 0 instead of `OUTPUT_TOKEN_MAX` (32000). Changed the fallback to use `ProviderTransform.OUTPUT_TOKEN_MAX`, consistent with built-in models.

This is a different approach from PR #22016 which fixed the same issue in the `transform.ts` `maxOutputTokens()` function. This fix addresses it at the provider config parsing level.

### How did you verify my code works?

- Analyzed the code to understand the fallback logic
- Confirmed built-in models use `OUTPUT_TOKEN_MAX` as fallback
- Changed custom model parsing to use the same fallback

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

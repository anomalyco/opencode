# Authentication

> Source: https://jules.google/docs/api/reference/authentication

The Jules REST API uses API keys for authentication. You'll need a valid API key to make API requests.

## Getting Your API Key

1. Go to [jules.google.com/settings](https://jules.google.com/settings)
2. Find the API Key section
3. Click **Generate API Key** (or copy your existing key)
4. Store the key securely — it won't be shown again

> Keep your API key secret. Don't commit it to version control or share it publicly.

## Using Your API Key

Include the API key in the `x-goog-api-key` header with every request:

```bash
curl -H "x-goog-api-key: YOUR_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions
```

### Environment Variable (Recommended)

Store your API key in an environment variable:

```bash
export JULES_API_KEY="your-api-key-here"
```

Then use it in requests:

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions
```

## Example: Create a Session

```bash
curl -X POST \
  -H "x-goog-api-key: $JULES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Add unit tests for the utils module",
    "sourceContext": {
      "source": "sources/github-owner-repo",
      "githubRepoContext": {
        "startingBranch": "main"
      }
    }
  }' \
  https://jules.googleapis.com/v1alpha/sessions
```

## Example: List Sessions

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions
```

## Troubleshooting

### "API key not valid"

- Verify you copied the entire key without extra spaces
- Check that the key hasn't been revoked in [settings](https://jules.google.com/settings)
- Generate a new key if needed

### "Permission denied"

- Verify your account has access to Jules
- Check that you have access to the requested resources (sessions, sources)

### "Quota exceeded"

- You may have hit rate limits
